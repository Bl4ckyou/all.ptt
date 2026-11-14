import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Find a server binary by name, preferring the shallowest match.
export async function findBinary(directory: string, names: string[]): Promise<string | null> {
  const wanted = new Set(names);
  let best: { path: string; depth: number } | null = null;

  async function walk(current: string, depth: number): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (wanted.has(entry.name) && (best === null || depth < best.depth)) {
        best = { path: full, depth };
      }
    }
  }

  await walk(directory, 0);
  return (best as { path: string } | null)?.path ?? null;
}

export async function makeExecutable(path: string, os: string): Promise<void> {
  if (os !== 'win32') await chmod(path, 0o755);
}
