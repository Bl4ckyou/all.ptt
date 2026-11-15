import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_TYPE_NAMES } from './file-types.generated.js';

function findBinaries(directory: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) findBinaries(path, found);
    else if (entry.name === 'llama-quantize' || entry.name === 'llama-quantize.exe') found.push(path);
  }
  return found;
}

function run(binary: string, args: string[]): string {
  try {
    return execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

function parseTypes(text: string): Record<number, string> {
  const names: Record<number, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+or\s+([A-Z0-9_]+)\s+:/);
    if (match) names[Number(match[1])] = match[2];
  }
  return names;
}

function readTypes(binary: string): Record<number, string> {
  return { ...parseTypes(run(binary, [])), ...parseTypes(run(binary, ['--help'])) };
}

const declared: Record<number, string> = {};
const binaries = findBinaries(join(process.cwd(), '.backends')).sort(
  (a, b) => Number(a.includes('/ik-llama-cpp/')) - Number(b.includes('/ik-llama-cpp/')),
);
for (const binary of binaries) {
  const names = readTypes(binary);
  if (Object.keys(names).length === 0) continue;
  for (const [id, name] of Object.entries(names)) declared[Number(id)] ??= name;
}

describe('FILE_TYPE_NAMES', () => {
  it.skipIf(Object.keys(declared).length === 0)(
    'matches every quantization type exposed by the installed backends',
    () => {
      const mismatched = Object.entries(declared)
        .map(([id, name]) => ({ id: Number(id), expected: name, actual: FILE_TYPE_NAMES[Number(id)] }))
        .filter((entry) => entry.actual !== entry.expected);
      expect(mismatched).toEqual([]);
    },
  );

  it('covers ik_llama.cpp extensions', () => {
    for (const id of [135, 136, 153, 157, 169, 219, 351]) {
      expect(FILE_TYPE_NAMES[id]).toBeTruthy();
    }
  });

  it('keeps file types that llama-quantize does not expose', () => {
    for (const id of [33, 34, 35, 39, 42]) expect(FILE_TYPE_NAMES[id]).toBeTruthy();
  });
});
