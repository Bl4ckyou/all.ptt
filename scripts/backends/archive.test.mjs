import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { extractArchive } from './archive.mjs';
import { findBinary } from './find-binary.mjs';

const temporaryDirectories = [];

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-backends-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('extractArchive', () => {
  it('extracts a zip and discovers the server binary', async () => {
    const directory = await workspace();
    const archive = join(directory, 'bundle.zip');
    await writeFile(archive, zipSync({ 'build/bin/llama-server': new Uint8Array([1, 2, 3]) }));

    const output = join(directory, 'out');
    await extractArchive(archive, output);
    const binary = await findBinary(output, ['llama-server']);

    expect(binary).not.toBeNull();
    expect([...(await readFile(binary))]).toEqual([1, 2, 3]);
  });

  it('does not write outside the destination', async () => {
    const directory = await workspace();
    const archive = join(directory, 'unsafe.zip');
    await writeFile(archive, zipSync({ '../escaped.txt': new Uint8Array([9]) }));

    const output = join(directory, 'out');
    await extractArchive(archive, output);

    await expect(stat(join(directory, 'escaped.txt'))).rejects.toThrow();
  });
});
