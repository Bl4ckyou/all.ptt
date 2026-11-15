import { open, stat, type FileHandle } from 'node:fs/promises';
import type { GgufModelInfo } from '@ptt/core';
import { FILE_TYPE_NAMES } from './file-types.generated.js';

const discoveredFileTypes = new Map<number, string>();

export function mergeFileTypeNames(types: Record<number, string>): void {
  for (const [id, name] of Object.entries(types)) {
    const key = Number(id);
    if (!discoveredFileTypes.has(key)) discoveredFileTypes.set(key, name);
  }
}

const MAGIC = 0x46554747;
const CHUNK_SIZE = 256 * 1024;

const FIXED_SIZES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};

class ByteReader {
  private chunk = Buffer.alloc(0);
  private chunkStart = 0;
  private position = 0;

  constructor(private readonly handle: FileHandle) {}

  private async fill(need: number): Promise<void> {
    const size = Math.max(CHUNK_SIZE, need);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await this.handle.read(buffer, 0, size, this.position);
    this.chunk = buffer.subarray(0, bytesRead);
    this.chunkStart = this.position;
  }

  private async ensure(size: number): Promise<void> {
    const relative = this.position - this.chunkStart;
    if (relative >= 0 && relative + size <= this.chunk.length) return;
    await this.fill(size);
  }

  async bytes(size: number): Promise<Buffer> {
    await this.ensure(size);
    const start = this.position - this.chunkStart;
    const slice = this.chunk.subarray(start, start + size);
    this.position += size;
    return slice;
  }

  async u32(): Promise<number> {
    return (await this.bytes(4)).readUInt32LE(0);
  }

  async i32(): Promise<number> {
    return (await this.bytes(4)).readInt32LE(0);
  }

  async u64(): Promise<number> {
    return Number((await this.bytes(8)).readBigUInt64LE(0));
  }

  async text(): Promise<string> {
    const length = await this.u64();
    if (length > 16_000_000) throw new Error('gguf string too large');
    return (await this.bytes(length)).toString('utf8');
  }

  async skip(size: number): Promise<void> {
    this.position += size;
  }

  async skipString(): Promise<void> {
    const length = await this.u64();
    await this.skip(length);
  }
}

async function skipValue(reader: ByteReader, type: number): Promise<void> {
  if (type === 8) {
    await reader.skipString();
    return;
  }
  if (type === 9) {
    const elementType = await reader.u32();
    const count = await reader.u64();
    if (elementType === 8) {
      for (let index = 0; index < count; index++) await reader.skipString();
      return;
    }
    const size = FIXED_SIZES[elementType];
    if (!size) throw new Error(`unsupported gguf array type: ${elementType}`);
    await reader.skip(size * count);
    return;
  }

  const size = FIXED_SIZES[type];
  if (!size) throw new Error(`unsupported gguf value type: ${type}`);
  await reader.skip(size);
}

async function readNumbers(reader: ByteReader, type: number): Promise<number | number[] | null> {
  if (type === 4) return reader.u32();
  if (type === 5) return reader.i32();
  if (type === 10) return reader.u64();

  if (type === 9) {
    const elementType = await reader.u32();
    const count = await reader.u64();
    if (elementType === 8) {
      for (let index = 0; index < count; index += 1) await reader.skipString();
      return null;
    }
    if (elementType !== 4 && elementType !== 5) {
      const size = FIXED_SIZES[elementType];
      if (!size) throw new Error(`unsupported gguf array type: ${elementType}`);
      await reader.skip(size * count);
      return null;
    }
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      values.push(elementType === 4 ? await reader.u32() : await reader.i32());
    }
    return values;
  }

  await skipValue(reader, type);
  return null;
}

function scalar(value: number | number[] | null | undefined): number | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length > 0 ? Math.max(...value) : null;
  return value;
}

export type GgufCategory =
  | 'assistant'
  | 'dflash'
  | 'dflash2'
  | 'dspark'
  | 'eagle3'
  | 'lilicorr'
  | 'mtp'
  | 'other';

export interface GgufSignature {
  architecture: string | null;
  generalType: string | null;
  name: string | null;
  basename: string | null;
  tags: string[];
  blockCount: number | null;
  embeddingLength: number | null;
  contextLength: number | null;
  fileType: number | null;
  hasTokenizer: boolean;
  hasMtp: boolean;
}

export interface GgufClassification {
  kind: 'model' | 'mmproj';
  category: GgufCategory;
}

interface GgufMeta {
  signature: GgufSignature;
  info: GgufModelInfo;
}

class InvalidGgufError extends Error {}

const metadataCache = new Map<string, { mtimeMs: number; meta: GgufMeta }>();

function emptySignature(): GgufSignature {
  return {
    architecture: null,
    generalType: null,
    name: null,
    basename: null,
    tags: [],
    fileType: null,
    blockCount: null,
    embeddingLength: null,
    contextLength: null,
    hasTokenizer: false,
    hasMtp: false,
  };
}

async function readText(reader: ByteReader, type: number): Promise<string | null> {
  if (type !== 8) {
    await skipValue(reader, type);
    return null;
  }
  return reader.text();
}

async function readStringElements(reader: ByteReader): Promise<string[]> {
  const elementType = await reader.u32();
  const count = await reader.u64();
  if (elementType !== 8) {
    const size = FIXED_SIZES[elementType];
    if (!size) throw new Error(`unsupported gguf array type: ${elementType}`);
    await reader.skip(size * count);
    return [];
  }

  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index < 256) values.push(await reader.text());
    else await reader.skipString();
  }
  return values;
}

async function scanGguf(path: string): Promise<GgufMeta> {
  const fileStat = await stat(path);
  const cached = metadataCache.get(path);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.meta;

  const handle = await open(path, 'r');
  try {
    const reader = new ByteReader(handle);
    const magic = (await reader.bytes(4)).readUInt32LE(0);
    if (magic !== MAGIC) throw new InvalidGgufError('not a gguf file');

    await reader.u32();
    await reader.u64();
    const kvCount = await reader.u64();

    const signature = emptySignature();
    const values: Record<string, number | number[]> = {};

    metadata: for (let index = 0; index < kvCount; index += 1) {
      let key: string;
      let type: number;
      try {
        key = await reader.text();
        type = await reader.u32();
      } catch {
        break;
      }

      if (/mtp/i.test(key)) signature.hasMtp = true;

      try {
        if (key === 'general.architecture') {
          signature.architecture = await readText(reader, type);
        } else if (key === 'general.type') {
          signature.generalType = await readText(reader, type);
        } else if (key === 'general.name') {
          signature.name = await readText(reader, type);
        } else if (key === 'general.basename') {
          signature.basename = await readText(reader, type);
        } else if (key === 'general.tags' && type === 9) {
          signature.tags = await readStringElements(reader);
        } else if (key === 'general.file_type') {
          signature.fileType = scalar(await readNumbers(reader, type));
        } else if (key.endsWith('.block_count')) {
          signature.blockCount = scalar(await readNumbers(reader, type));
          values.block_count = signature.blockCount ?? [];
        } else if (key.endsWith('.embedding_length')) {
          signature.embeddingLength = scalar(await readNumbers(reader, type));
          values.embedding_length = signature.embeddingLength ?? [];
        } else if (key.endsWith('.context_length')) {
          signature.contextLength = scalar(await readNumbers(reader, type));
          values.context_length = signature.contextLength ?? [];
        } else if (key.endsWith('.attention.head_count')) {
          values['attention.head_count'] = (await readNumbers(reader, type)) ?? [];
        } else if (key.endsWith('.attention.head_count_kv')) {
          values['attention.head_count_kv'] = (await readNumbers(reader, type)) ?? [];
        } else {
          await skipValue(reader, type);
          if (key.startsWith('tokenizer.')) {
            signature.hasTokenizer = true;
            if (signature.architecture || signature.generalType || signature.name) break metadata;
          }
        }
      } catch {
        break;
      }
    }

    const metadataText = [
      signature.architecture,
      signature.name,
      signature.basename,
      ...signature.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (/(^|[^a-z0-9])mtp([^a-z0-9]|$)/.test(metadataText)) signature.hasMtp = true;

    const info: GgufModelInfo = {
      size: fileStat.size,
      blockCount: scalar(values.block_count),
      embeddingLength: scalar(values.embedding_length),
      headCount: scalar(values['attention.head_count']),
      headCountKv: scalar(values['attention.head_count_kv']),
      contextLength: scalar(values.context_length),
    };

    const meta: GgufMeta = { signature, info };
    metadataCache.set(path, { mtimeMs: fileStat.mtimeMs, meta });
    return meta;
  } finally {
    await handle.close();
  }
}

export async function readGgufInfo(path: string): Promise<GgufModelInfo> {
  return (await scanGguf(path)).info;
}

export async function readGgufSignature(path: string): Promise<GgufSignature> {
  try {
    return (await scanGguf(path)).signature;
  } catch (error) {
    if (error instanceof InvalidGgufError) return emptySignature();
    throw error;
  }
}

function wordMatch(text: string, word: string): boolean {
  return new RegExp(`(^|[-_. ])${word}([-_. ]|$)`, 'i').test(text);
}

const QUANT_IN_NAME = /(?<![A-Z0-9])(I?P?T?Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|FP16|FP32)(?![A-Z0-9])/gi;

// Read the quantization from metadata first, then from the file name.
export function quantizationOf(fileName: string, signature: GgufSignature | null): string | null {
  const fileType = signature?.fileType;
  const fromMetadata =
    fileType != null
      ? (discoveredFileTypes.get(fileType) ?? FILE_TYPE_NAMES[fileType] ?? `FTYPE_${fileType}`)
      : null;
  const fromName = fileName
    .replace(/\.gguf$/i, '')
    .match(QUANT_IN_NAME)
    ?.map((token) => token.toUpperCase());
  if (fromMetadata && fromName?.some((token) => token === fromMetadata)) return fromMetadata;
  return fromName?.at(-1) ?? fromMetadata;
}

// Text and vision-language GGUF files carry a tokenizer; diffusion files do not.
export function isTextModel(signature: GgufSignature | null): boolean {
  return !signature || signature.hasTokenizer;
}

// Classify a GGUF file from its metadata first, then fall back to its name.
export function classifyGguf(
  fileName: string,
  signature: GgufSignature | null,
): GgufClassification {
  const lower = fileName.toLowerCase();
  const architecture = (signature?.architecture ?? '').toLowerCase();
  const generalType = (signature?.generalType ?? '').toLowerCase();

  const haystack = [
    architecture,
    generalType,
    signature?.name ?? '',
    signature?.basename ?? '',
    ...(signature?.tags ?? []),
    lower,
  ]
    .join(' ')
    .toLowerCase();

  const isMmproj =
    generalType === 'mmproj' ||
    architecture === 'clip' ||
    architecture.includes('clip') ||
    wordMatch(lower, 'mmproj');

  if (isMmproj) return { kind: 'mmproj', category: 'other' };

  let category: GgufCategory = 'other';
  const compact = haystack.replace(/[^a-z0-9]/g, '');

  if (compact.includes('lilicorr')) category = 'lilicorr';
  else if (compact.includes('eagle3')) category = 'eagle3';
  else if (compact.includes('dflash2')) category = 'dflash2';
  else if (wordMatch(haystack, 'dspark')) category = 'dspark';
  else if (wordMatch(haystack, 'dflash')) category = 'dflash';
  else if (wordMatch(haystack, 'mtp')) category = 'mtp';
  else if (wordMatch(haystack, 'assistant') || wordMatch(haystack, 'draft')) category = 'assistant';
  else if (architecture.endsWith('-assistant')) category = 'assistant';

  return { kind: 'model', category };
}
