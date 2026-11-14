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

export async function readGgufInfo(path: string): Promise<GgufModelInfo> {
  const fileStat = await stat(path);
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
