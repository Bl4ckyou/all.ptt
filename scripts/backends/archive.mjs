import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { unzipSync } from 'fflate';
import { x as extractTar } from 'tar';

function safePath(base, entry) {
  const cleaned = normalize(entry).replace(/^([/\\])+/, '');
  if (cleaned.startsWith('..')) return null;
  return join(base, cleaned);
}

async function extractZip(file, destination) {
  const entries = unzipSync(new Uint8Array(await readFile(file)));

  for (const [entry, bytes] of Object.entries(entries)) {
    const target = safePath(destination, entry);
    if (!target) continue;

    if (entry.endsWith('/')) {
      await mkdir(target, { recursive: true });
      continue;
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

export async function extractArchive(file, destination) {
  await mkdir(destination, { recursive: true });

  if (file.endsWith('.zip')) {
    await extractZip(file, destination);
    return;
  }
  if (file.endsWith('.tar.gz') || file.endsWith('.tgz')) {
    await extractTar({ file, cwd: destination });
    return;
  }
  throw new Error(`unsupported archive: ${file}`);
}
