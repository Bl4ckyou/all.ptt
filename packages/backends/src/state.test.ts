import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installedStatePath,
  readInstalledState,
  readInstalledStates,
  resolveInstalledBinary,
} from './state.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-state-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeState(root: string, id: string, value: unknown): Promise<void> {
  await mkdir(join(root, '.backends', id), { recursive: true });
  await writeFile(installedStatePath(root, id), JSON.stringify(value));
}

const variant = {
  variant: 'auto',
  target: 'linux-x64-vulkan',
  tag: 'b5000',
  asset: 'llama.zip',
  size: 100,
  installedAt: '2026-01-01T00:00:00.000Z',
  binary: '/tmp/llama-server',
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('readInstalledState', () => {
  it('returns an empty state when nothing is installed', async () => {
    const root = await workspace();
    await expect(readInstalledState(root, 'llama')).resolves.toEqual({
      backend: 'llama',
      variants: {},
    });
  });

  it('reads a modern state file', async () => {
    const root = await workspace();
    await writeState(root, 'llama', { backend: 'llama', variants: { [variant.target]: variant } });

    const state = await readInstalledState(root, 'llama');
    expect(state.backend).toBe('llama');
    expect(state.variants[variant.target]).toEqual(variant);
  });

  it('migrates the legacy flat record', async () => {
    const root = await workspace();
    await writeState(root, 'llama', { ...variant, variant: undefined });

    const state = await readInstalledState(root, 'llama');
    const record = state.variants[variant.target];
    expect(record).toMatchObject({ legacy: true, variant: 'auto', binary: variant.binary });
  });

  it('rejects a corrupt state file instead of resetting it', async () => {
    const root = await workspace();
    await mkdir(join(root, '.backends', 'llama'), { recursive: true });
    await writeFile(installedStatePath(root, 'llama'), '{ corrupt');

    await expect(readInstalledState(root, 'llama')).rejects.toThrow();
  });
});

describe('readInstalledStates', () => {
  it('aggregates every backend directory', async () => {
    const root = await workspace();
    await writeState(root, 'llama', { backend: 'llama', variants: { [variant.target]: variant } });
    await writeState(root, 'ik', { backend: 'ik', variants: {} });

    const states = await readInstalledStates(root);
    expect(Object.keys(states).sort()).toEqual(['ik', 'llama']);
  });

  it('returns an empty record when no backend is installed', async () => {
    const root = await workspace();
    await expect(readInstalledStates(root)).resolves.toEqual({});
  });
});

describe('resolveInstalledBinary', () => {
  it('finds the first variant with a binary', async () => {
    const root = await workspace();
    await writeState(root, 'llama', { backend: 'llama', variants: { [variant.target]: variant } });

    await expect(resolveInstalledBinary(root, 'llama')).resolves.toEqual({
      backendId: 'llama',
      record: variant,
    });
  });

  it('returns null when no variant has a binary', async () => {
    const root = await workspace();
    await writeState(root, 'llama', {
      backend: 'llama',
      variants: { [variant.target]: { ...variant, binary: '' } },
    });

    await expect(resolveInstalledBinary(root, 'llama')).resolves.toBeNull();
  });
});
