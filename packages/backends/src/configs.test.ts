import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configsPath, readModelConfig, readModelConfigs, writeModelConfig } from './configs.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-configs-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('model configs', () => {
  it('returns an empty map when no config file exists', async () => {
    const root = await workspace();
    await expect(readModelConfigs(root)).resolves.toEqual({});
    await expect(readModelConfig(root, '/models/a.gguf')).resolves.toBeNull();
  });

  it('persists a config with an updatedAt timestamp', async () => {
    const root = await workspace();
    const path = '/models/a.gguf';

    const record = await writeModelConfig(root, path, {
      settings: { contextSize: 4096 },
      extraArgs: '--threads 8',
    });

    expect(record.updatedAt).toEqual(expect.any(String));
    await expect(readModelConfig(root, path)).resolves.toEqual(record);
    await expect(readModelConfigs(root)).resolves.toEqual({ [path]: record });
  });

  it('preserves other models when writing a config', async () => {
    const root = await workspace();
    await writeModelConfig(root, '/models/a.gguf', { settings: {}, extraArgs: '' });
    await writeModelConfig(root, '/models/b.gguf', { settings: {}, extraArgs: '--ctx 2048' });

    const configs = await readModelConfigs(root);
    expect(Object.keys(configs).sort()).toEqual(['/models/a.gguf', '/models/b.gguf']);
  });

  it('refuses to overwrite a corrupt config file', async () => {
    const root = await workspace();
    const file = configsPath(root);
    await mkdir(join(root, '.ptt'), { recursive: true });
    await writeFile(file, '{ corrupt');

    await expect(
      writeModelConfig(root, '/models/a.gguf', { settings: {}, extraArgs: '' }),
    ).rejects.toThrow();
    await expect(readFile(file, 'utf8')).resolves.toBe('{ corrupt');
  });

  it('leaves no temporary file behind', async () => {
    const root = await workspace();
    await writeModelConfig(root, '/models/a.gguf', { settings: {}, extraArgs: '' });
    const entries = await readdir(join(root, '.ptt'));
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });
});
