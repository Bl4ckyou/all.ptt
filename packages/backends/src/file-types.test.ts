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

function help(binary: string): string {
  try {
    return execFileSync(binary, ['--help'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

function parse(text: string): Record<number, string> {
  const names: Record<number, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+or\s+([A-Z0-9_]+)\s+:/);
    if (match) names[Number(match[1])] = match[2];
  }
  return names;
}

const parsed: Record<number, string> = {};
for (const binary of findBinaries(join(process.cwd(), '.backends'))) {
  const names = parse(help(binary));
  if (Object.keys(names).length > 0) {
    Object.assign(parsed, names);
    break;
  }
}

describe('FILE_TYPE_NAMES', () => {
  it.skipIf(Object.keys(parsed).length === 0)(
    'matches the quantization types exposed by llama-quantize',
    () => {
      const mismatched = Object.entries(parsed)
        .map(([id, name]) => ({ id: Number(id), expected: name, actual: FILE_TYPE_NAMES[Number(id)] }))
        .filter((entry) => entry.actual !== entry.expected);
      expect(mismatched).toEqual([]);
    },
  );

  it('keeps file types that llama-quantize does not expose', () => {
    for (const id of [33, 34, 35, 39, 42]) expect(FILE_TYPE_NAMES[id]).toBeTruthy();
  });
});
