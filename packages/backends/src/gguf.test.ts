import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGgufInfo } from './gguf.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function ggufString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(data.length), data]);
}

function entry(key: string, type: number, value: Buffer): Buffer {
  return Buffer.concat([ggufString(key), u32(type), value]);
}

function buildGguf(): Buffer {
  const stringArray = Buffer.concat([
    u32(8),
    u64(2),
    ggufString('hello'),
    ggufString('world'),
  ]);

  const entries = [
    entry('tokenizer.ggml.tokens', 9, stringArray),
    entry('general.architecture', 8, ggufString('llama')),
    entry('llama.block_count', 4, u32(32)),
    entry('llama.embedding_length', 4, u32(4096)),
    entry('llama.attention.head_count', 4, u32(32)),
    entry('llama.attention.head_count_kv', 9, Buffer.concat([u32(4), u64(1), u32(8)])),
    entry('llama.context_length', 4, u32(8192)),
    entry('llama.vocab_size', 4, u32(32000)),
  ];

  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(0),
    u64(entries.length),
    ...entries,
  ]);
}

describe('readGgufInfo', () => {
  it('reads architecture metadata and skips string arrays', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptt-gguf-'));
    temporaryDirectories.push(directory);

    const file = join(directory, 'model.gguf');
    const data = buildGguf();
    await writeFile(file, data);

    const info = await readGgufInfo(file);

    expect(info.size).toBe(data.length);
    expect(info.blockCount).toBe(32);
    expect(info.embeddingLength).toBe(4096);
    expect(info.headCount).toBe(32);
    expect(info.headCountKv).toBe(8);
    expect(info.contextLength).toBe(8192);
  });

  it('rejects files that are not GGUF', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptt-gguf-'));
    temporaryDirectories.push(directory);

    const file = join(directory, 'model.gguf');
    await writeFile(file, 'not a model');
    await expect(readGgufInfo(file)).rejects.toThrow();
  });
});
