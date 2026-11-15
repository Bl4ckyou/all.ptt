import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCustomBackends, writeCustomBackends } from './custom-backends.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-custom-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('custom backend store', () => {
  it('returns an empty store when the file does not exist', async () => {
    await expect(readCustomBackends(await workspace())).resolves.toEqual({ backends: {} });
  });

  it('round-trips custom backends', async () => {
    const root = await workspace();
    await writeCustomBackends(root, {
      backends: {
        demo: {
          label: 'Demo',
          repo: 'local',
          defaultVariant: 'auto',
          binaries: ['demo'],
          selection: [],
          kind: 'local',
          custom: true,
          local: { binary: '/opt/demo/server' },
        },
      },
    });

    const store = await readCustomBackends(root);
    expect(store.backends.demo.label).toBe('Demo');
    expect(store.backends.demo.local?.binary).toBe('/opt/demo/server');
  });
});
