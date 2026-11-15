import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cachedArchive } from './install.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-install-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('cachedArchive', () => {
  it('accepts an archive whose size matches the release asset', async () => {
    const directory = await workspace();
    const file = join(directory, 'llama.zip');
    await writeFile(file, 'hello');
    await expect(cachedArchive(file, 5)).resolves.toBe(true);
  });

  it('rejects a partial or stale archive', async () => {
    const directory = await workspace();
    const file = join(directory, 'llama.zip');
    await writeFile(file, 'hello');
    await expect(cachedArchive(file, 10)).resolves.toBe(false);
  });

  it('rejects a missing archive', async () => {
    const directory = await workspace();
    await expect(cachedArchive(join(directory, 'missing.zip'), 10)).resolves.toBe(false);
  });

  it('does not trust a cache when the size is unknown', async () => {
    const directory = await workspace();
    const file = join(directory, 'llama.zip');
    await writeFile(file, 'hello');
    await expect(cachedArchive(file, 0)).resolves.toBe(false);
  });
});
