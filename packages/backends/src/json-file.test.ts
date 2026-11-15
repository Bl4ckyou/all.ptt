import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile, writeJsonFile } from './json-file.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-json-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('readJsonFile', () => {
  it('returns null when the file does not exist', async () => {
    const directory = await workspace();
    await expect(readJsonFile(join(directory, 'missing.json'))).resolves.toBeNull();
  });

  it('parses an existing file', async () => {
    const directory = await workspace();
    const file = join(directory, 'value.json');
    await writeFile(file, JSON.stringify({ ok: true }));
    await expect(readJsonFile(file)).resolves.toEqual({ ok: true });
  });

  it('rejects invalid JSON instead of silently resetting', async () => {
    const directory = await workspace();
    const file = join(directory, 'broken.json');
    await writeFile(file, '{ not json');
    await expect(readJsonFile(file)).rejects.toThrow();
    await expect(readFile(file, 'utf8')).resolves.toBe('{ not json');
  });
});

describe('writeJsonFile', () => {
  it('creates parent directories and writes formatted JSON', async () => {
    const directory = await workspace();
    const file = join(directory, 'nested', 'value.json');
    await writeJsonFile(file, { a: 1 });
    await expect(readFile(file, 'utf8')).resolves.toBe('{\n  "a": 1\n}\n');
  });

  it('leaves no temporary file behind', async () => {
    const directory = await workspace();
    await writeJsonFile(join(directory, 'value.json'), { a: 1 });
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the file valid under concurrent writes', async () => {
    const directory = await workspace();
    const file = join(directory, 'value.json');
    await Promise.all(
      Array.from({ length: 25 }, (_value, index) => writeJsonFile(file, { index })),
    );

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { index: number };
    expect(parsed.index).toBeGreaterThanOrEqual(0);
    expect(parsed.index).toBeLessThan(25);
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });
});
