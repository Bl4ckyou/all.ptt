import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findTranslationModel } from './translation-backend.js';

const temporaryDirectories: string[] = [];
const originalHub = process.env.HF_HUB_CACHE;

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-translation-'));
  temporaryDirectories.push(directory);
  return directory;
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
    await writeFile(file, Buffer.alloc(2048));

    await expect(findTranslationModel([])).resolves.toBe(file);
  });

  it('searches extra model directories and prefers Q4_K_M', async () => {
    const emptyHub = await workspace();
    process.env.HF_HUB_CACHE = emptyHub;
    const models = await workspace();
    await writeFile(join(models, 'plamo-3-translate-0.8b-Q2_K.gguf'), Buffer.alloc(2048));
    const preferred = join(models, 'plamo-3-translate-0.8b-Q4_K_M.gguf');
    await writeFile(preferred, Buffer.alloc(2048));

    await expect(findTranslationModel([models])).resolves.toBe(preferred);
  });

  it('returns null when nothing is found', async () => {
    const emptyHub = await workspace();
    process.env.HF_HUB_CACHE = emptyHub;
    await expect(findTranslationModel([emptyHub])).resolves.toBeNull();
  });
});
