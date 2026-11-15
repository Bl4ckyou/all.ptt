import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyGguf,
  isTextModel,
  quantizationOf,
  readGgufInfo,
  readGgufSignature,
} from './gguf.js';

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
  const tokens = Buffer.concat([
    u32(8),
    u64(2),
    ggufString('hello'),
    ggufString('world'),
  ]);
  const tags = Buffer.concat([u32(8), u64(2), ggufString('chat'), ggufString('test')]);

  const entries = [
    entry('general.architecture', 8, ggufString('llama')),
    entry('general.type', 8, ggufString('model')),
    entry('general.name', 8, ggufString('Test Model')),
    entry('general.basename', 8, ggufString('test-baseline')),
    entry('general.tags', 9, tags),
    entry('general.file_type', 4, u32(15)),
    entry('llama.block_count', 4, u32(32)),
    entry('llama.embedding_length', 4, u32(4096)),
    entry('llama.attention.head_count', 4, u32(32)),
    entry('llama.attention.head_count_kv', 9, Buffer.concat([u32(4), u64(1), u32(8)])),
    entry('llama.context_length', 4, u32(8192)),
    entry('llama.vocab_size', 4, u32(32000)),
    entry('llama.mtp_head', 4, u32(1)),
    entry('tokenizer.ggml.tokens', 9, tokens),
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

describe('readGgufSignature', () => {
  it('reads general metadata before the tokenizer block', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptt-gguf-'));
    temporaryDirectories.push(directory);

    const file = join(directory, 'model.gguf');
    await writeFile(file, buildGguf());

    const signature = await readGgufSignature(file);
    expect(signature.architecture).toBe('llama');
    expect(signature.generalType).toBe('model');
    expect(signature.name).toBe('Test Model');
    expect(signature.basename).toBe('test-baseline');
    expect(signature.tags).toEqual(['chat', 'test']);
    expect(signature.blockCount).toBe(32);
    expect(signature.embeddingLength).toBe(4096);
    expect(signature.contextLength).toBe(8192);
    expect(signature.fileType).toBe(15);
    expect(signature.hasTokenizer).toBe(true);
    expect(signature.hasMtp).toBe(true);
  });
});

describe('quantizationOf', () => {
  it('uses metadata when the name contains the same quantization', () => {
    expect(quantizationOf('Qwen3-4B-IQ4_XS.gguf', sig({ fileType: 30 }))).toBe('IQ4_XS');
  });

  it('keeps an extended name quantization over a coarse metadata type', () => {
    expect(quantizationOf('gemma-UD-Q4_K_XL.gguf', sig({ fileType: 15 }))).toBe('Q4_K_XL');
  });

  it('falls back to metadata for names without a quantization', () => {
    expect(quantizationOf('model.gguf', sig({ fileType: 15 }))).toBe('Q4_K_M');
  });

  it('returns null when nothing is known', () => {
    expect(quantizationOf('model.gguf', sig({ fileType: null }))).toBeNull();
  });
});

describe('isTextModel', () => {
  it('accepts text and vision models with a tokenizer', () => {
    expect(isTextModel(sig({ hasTokenizer: true }))).toBe(true);
  });

  it('rejects diffusion GGUF files without a tokenizer', () => {
    expect(isTextModel(sig({ hasTokenizer: false }))).toBe(false);
  });
});

const sig = (partial: Partial<import('./gguf.js').GgufSignature>) => ({
  architecture: null,
  generalType: null,
  name: null,
  basename: null,
  tags: [],
  blockCount: null,
  embeddingLength: null,
  contextLength: null,
  fileType: null,
  hasTokenizer: true,
  hasMtp: false,
  ...partial,
});

describe('classifyGguf', () => {
  it('detects mmproj from metadata even with an unrelated file name', () => {
    expect(
      classifyGguf('whatever.gguf', sig({ architecture: 'clip', generalType: 'mmproj' })),
    ).toEqual({ kind: 'mmproj', category: 'other' });
  });

  it('classifies assistant metadata when the file was renamed', () => {
    expect(
      classifyGguf(
        'renamed.gguf',
        sig({ architecture: 'gemma4-assistant', generalType: 'model', name: 'E2B Assistant' }),
      ),
    ).toEqual({ kind: 'model', category: 'assistant' });
  });

  it('prefers the mtp category when the metadata or name says mtp', () => {
    expect(
      classifyGguf(
        'mtp-gemma.gguf',
        sig({ architecture: 'gemma4-assistant', generalType: 'model', name: 'E2B Assistant' }),
      ),
    ).toEqual({ kind: 'model', category: 'mtp' });
  });

  it('recognizes dflash and dspark from metadata', () => {
    const base = sig({ generalType: 'model' });
    expect(classifyGguf('a.gguf', { ...base, architecture: 'gemma4-dflash' }).category).toBe(
      'dflash',
    );
    expect(classifyGguf('b.gguf', { ...base, architecture: 'gemma4-dspark' }).category).toBe(
      'dspark',
    );
  });

  it('recognizes dflash2, eagle3 and lilicorr', () => {
    const base = sig({ generalType: 'model' });
    expect(classifyGguf('a.gguf', { ...base, name: 'DFlash2' }).category).toBe('dflash2');
    expect(classifyGguf('b.gguf', { ...base, tags: ['Eagle3'] }).category).toBe('eagle3');
    expect(classifyGguf('c.gguf', { ...base, architecture: 'gemma4-lilicorr' }).category).toBe(
      'lilicorr',
    );
  });

  it('keeps regular models as other', () => {
    expect(
      classifyGguf(
        'gemma.gguf',
        sig({ architecture: 'gemma4', generalType: 'model', name: 'Gemma' }),
      ),
    ).toEqual({ kind: 'model', category: 'other' });
  });
});
