import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadManifest } from './manifest.js';
import { resolveInstalledBinary } from './state.js';

const run = promisify(execFile);
const manifest = loadManifest();
const root = process.cwd();

function collectFlags(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('--')) into.add(value.split(/\s/)[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectFlags(entry, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectFlags(entry, into);
  }
}

function mappedFlags(backendId: string): string[] {
  const flags = new Set<string>();
  collectFlags(manifest.backends[backendId].settings, flags);
  return [...flags].sort();
}

async function helpFlags(binary: string): Promise<Set<string>> {
  let output = '';
  try {
    const result = await run(binary, ['--help'], { maxBuffer: 64 * 1024 * 1024 });
    output = `${result.stdout}${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  return new Set(output.match(/--[a-z0-9][a-z0-9-]*/gi) ?? []);
}

const backends = Object.keys(manifest.backends);
const installed: Record<string, Awaited<ReturnType<typeof resolveInstalledBinary>>> = {};
for (const id of backends) installed[id] = await resolveInstalledBinary(root, id);

describe('backend flags', () => {
  for (const id of backends) {
    const binary = installed[id]?.record.binary;

    it.skipIf(!binary)(`${id}: every mapped flag exists in the real --help`, async () => {
      const flags = await helpFlags(binary!);
      const missing = mappedFlags(id).filter((flag) => !flags.has(flag));
      expect(missing).toEqual([]);
    });
  }
});
