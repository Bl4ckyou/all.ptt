import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findTranslationCandidates,
  findTranslationModel,
  splitForTranslation,
} from './translation-backend.js';

const temporaryDirectories: string[] = [];
const originalHub = process.env.HF_HUB_CACHE;

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-translation-'));
  temporaryDirectories.push(directory);
  return directory;
}

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

function text(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
}

function entry(key: string, type: number, value: Buffer): Buffer {
  return Buffer.concat([text(key), u32(type), value]);
}

function gguf(name: string): Buffer {
  const entries = [
    entry('general.architecture', 8, text('plamo')),
    entry('general.name', 8, text(name)),
    entry('plamo.context_length', 4, u32(8192)),
    entry('tokenizer.chat_template', 8, text('{% if target_lang %}x{% endif %}')),
  ];
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(0),
    u64(entries.length),
    ...entries,
  ]);
}

afterEach(async () => {
  if (originalHub === undefined) delete process.env.HF_HUB_CACHE;
  else process.env.HF_HUB_CACHE = originalHub;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('findTranslationModel', () => {
  it('finds a model in a Hugging Face style cache', async () => {
    const hub = await workspace();
    process.env.HF_HUB_CACHE = hub;
    const snapshot = join(
      hub,
      'models--pfnet--plamo-3-translate-0.8b-GGUF',
      'snapshots',
      'abc',
    );
    await mkdir(snapshot, { recursive: true });
    const file = join(snapshot, 'plamo-3-translate-0.8b-Q4_K_M.gguf');
    await writeFile(file, gguf('PLaMo 3 Translate 0.8B'));

    await expect(findTranslationModel([])).resolves.toBe(file);
  });

  it('searches extra model directories and prefers Q4_K_M', async () => {
    const emptyHub = await workspace();
    process.env.HF_HUB_CACHE = emptyHub;
    const models = await workspace();
    await writeFile(join(models, 'plamo-3-translate-0.8b-Q2_K.gguf'), gguf('PLaMo Q2'));
    const preferred = join(models, 'plamo-3-translate-0.8b-Q4_K_M.gguf');
    await writeFile(preferred, gguf('PLaMo Q4'));

    await expect(findTranslationModel([models])).resolves.toBe(preferred);
  });

  it('lists other translation models already in the cache', async () => {
    const emptyHub = await workspace();
    process.env.HF_HUB_CACHE = emptyHub;
    const models = await workspace();
    const file = join(models, 'translategemma-4b-it-Q4_K_M.gguf');
    await writeFile(file, gguf('TranslateGemma 4B'));

    const candidates = await findTranslationCandidates([models]);
    expect(candidates.map((candidate) => candidate.path)).toContain(file);
    expect(candidates.find((candidate) => candidate.path === file)?.targetLang).toBe(true);
  });

  it('returns null when nothing is found', async () => {
    const emptyHub = await workspace();
    process.env.HF_HUB_CACHE = emptyHub;
    await expect(findTranslationModel([emptyHub])).resolves.toBeNull();
  });
});

describe('splitForTranslation', () => {
  it('keeps short texts in one chunk', () => {
    expect(splitForTranslation('short text')).toEqual(['short text']);
  });

  it('splits long texts without losing content', () => {
    const text = 'This is a sentence. '.repeat(200);
    const chunks = splitForTranslation(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(201);
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.trim());
  });
});
