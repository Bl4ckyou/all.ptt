import { open, stat, type FileHandle } from 'node:fs/promises';
import type { GgufModelInfo } from '@ptt/core';

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

function scalar(value: number | number[] | undefined): number | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? Math.max(...value) : null;
  return value;
}

const WANTED = [
  'block_count',
  'embedding_length',
  'attention.head_count',
  'attention.head_count_kv',
  'context_length',
];

const cache = new Map<string, { mtimeMs: number; info: GgufModelInfo }>();

export async function readGgufInfo(path: string): Promise<GgufModelInfo> {  const fileStat = await stat(path);
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.info;

  const handle = await open(path, 'r');
  try {
    const reader = new ByteReader(handle);
    const magic = (await reader.bytes(4)).readUInt32LE(0);
    if (magic !== MAGIC) throw new Error('not a gguf file');

    await reader.u32();
    await reader.u64();
    const kvCount = await reader.u64();

    let architecture: string | null = null;
    const values: Record<string, number | number[]> = {};    for (let index = 0; index < kvCount; index++) {
      const key = await reader.text();
      const type = await reader.u32();

      if (key === 'general.architecture') {
        architecture = type === 8 ? await reader.text() : null;
        if (type !== 8) await skipValue(reader, type);
        continue;
      }

      const wanted = WANTED.find((suffix) => key === suffix || key.endsWith(`.${suffix}`));
      if (!wanted) {
        await skipValue(reader, type);
        continue;
      }

      const value = await readNumbers(reader, type);
      if (value !== null) values[wanted] = value;
    }

    const info: GgufModelInfo = {
      size: fileStat.size,
      blockCount: scalar(values.block_count),
      embeddingLength: scalar(values.embedding_length),
      headCount: scalar(values['attention.head_count']),
      headCountKv: scalar(values['attention.head_count_kv']),
      contextLength: scalar(values.context_length),
    };

    void architecture;
    cache.set(path, { mtimeMs: fileStat.mtimeMs, info });
    return info;
  } finally {
    await handle.close();
  }
}

export type GgufCategory = 'assistant' | 'dflash' | 'dspark' | 'mtp' | 'other';

export interface GgufSignature {
  architecture: string | null;
  generalType: string | null;
  name: string | null;
  basename: string | null;
  tags: string[];
  blockCount: number | null;
  embeddingLength: number | null;
  contextLength: number | null;
}

export interface GgufClassification {
  kind: 'model' | 'mmproj';
  category: GgufCategory;
}

const SIGNATURE_BYTES = 128 * 1024;
const signatureCache = new Map<string, { mtimeMs: number; signature: GgufSignature }>();

function parseSignature(buffer: Buffer): GgufSignature {
  const signature: GgufSignature = {
    architecture: null,
    generalType: null,
    name: null,
    basename: null,
    tags: [],
    blockCount: null,
    embeddingLength: null,
    contextLength: null,
  };

  let position = 0;
  const ensure = (size: number): void => {
    if (position + size > buffer.length) throw new RangeError('eof');
  };
  const u32 = (): number => {
    ensure(4);
    const value = buffer.readUInt32LE(position);
    position += 4;
    return value;
  };
  const i32 = (): number => {
    ensure(4);
    const value = buffer.readInt32LE(position);
    position += 4;
    return value;
  };
  const u64 = (): number => {
    ensure(8);
    const value = Number(buffer.readBigUInt64LE(position));
    position += 8;
    return value;
  };
  const text = (): string => {
    const length = u64();
    ensure(length);
    const value = buffer.toString('utf8', position, position + length);
    position += length;
    return value;
  };
  const skip = (size: number): void => {
    ensure(size);
    position += size;
  };

  const skipArrayElements = (elementType: number, count: number): void => {
    if (elementType === 8) {
      for (let index = 0; index < count; index++) skip(u64());
      return;
    }
    const size = FIXED_SIZES[elementType];
    if (!size) throw new Error(`unsupported gguf array type: ${elementType}`);
    skip(size * count);
  };

  const skipValue = (type: number): void => {
    if (type === 8) {
      skip(u64());
      return;
    }
    if (type === 9) {
      const elementType = u32();
      const count = u64();
      skipArrayElements(elementType, count);
      return;
    }
    const size = FIXED_SIZES[type];
    if (!size) throw new Error(`unsupported gguf value type: ${type}`);
    skip(size);
  };

  const readStringArray = (): string[] | null => {
    const elementType = u32();
    const count = u64();
    if (elementType !== 8) {
      skipArrayElements(elementType, count);
      return null;
    }
    const items: string[] = [];
    for (let index = 0; index < count; index++) {
      const value = text();
      if (index < 16) items.push(value);
    }
    return items;
  };

  const readNumber = (type: number): number | null => {
    if (type === 4) return u32();
    if (type === 5) return i32();
    if (type === 10) return u64();
    skipValue(type);
    return null;
  };

  try {
    if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'GGUF') return signature;
    position = 4;
    u32();
    u64();
    const kvCount = u64();

    for (let index = 0; index < kvCount; index++) {
      const key = text();
      const type = u32();

      if (key === 'general.architecture' && type === 8) signature.architecture = text();
      else if (key === 'general.type' && type === 8) signature.generalType = text();
      else if (key === 'general.name' && type === 8) signature.name = text();
      else if (key === 'general.basename' && type === 8) signature.basename = text();
      else if (key === 'general.tags' && type === 9) signature.tags = readStringArray() ?? [];
      else if (key.endsWith('.block_count')) signature.blockCount = readNumber(type);
      else if (key.endsWith('.embedding_length')) signature.embeddingLength = readNumber(type);
      else if (key.endsWith('.context_length')) signature.contextLength = readNumber(type);
      else {
        skipValue(type);
        if (
          key.startsWith('tokenizer.') &&
          (signature.architecture || signature.generalType || signature.name)
        ) {
          break;
        }
      }
    }
  } catch {
    // truncated buffer: keep whatever was parsed
  }

  return signature;
}

export async function readGgufSignature(path: string): Promise<GgufSignature> {
  const fileStat = await stat(path);
  const cached = signatureCache.get(path);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.signature;

  const size = Math.min(SIGNATURE_BYTES, fileStat.size);
  const buffer = Buffer.alloc(size);
  const handle = await open(path, 'r');
  try {
    await handle.read(buffer, 0, size, 0);
  } finally {
    await handle.close();
  }

  const signature = parseSignature(buffer);
  signatureCache.set(path, { mtimeMs: fileStat.mtimeMs, signature });
  return signature;
}

function wordMatch(text: string, word: string): boolean {
  return new RegExp(`(^|[-_. ])${word}([-_. ]|$)`, 'i').test(text);
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
  if (wordMatch(haystack, 'dspark')) category = 'dspark';
  else if (wordMatch(haystack, 'dflash')) category = 'dflash';
  else if (wordMatch(haystack, 'mtp')) category = 'mtp';
  else if (wordMatch(haystack, 'assistant') || wordMatch(haystack, 'draft')) category = 'assistant';
  else if (architecture.endsWith('-assistant')) category = 'assistant';

  return { kind: 'model', category };
}
