import { realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LocalModel {
  path: string;
  name: string;
  size: number;
  source: string;
}

// Skip projectors, MTP heads and non-first split parts.
export function isUsableModelFile(fileName: string): boolean {
  if (!fileName.toLowerCase().endsWith('.gguf')) return false;

  const base = fileName.replace(/\.gguf$/i, '');
  if (/(^|[-_.])mmproj([-_.]|$)/i.test(base)) return false;
  if (/(^|[-_.])mtp([-_.]|$)/i.test(base)) return false;

  const split = /-(\d{5})-of-(\d{5})$/i.exec(base);
  if (split && split[1] !== '00001') return false;

  return true;
}

function huggingFaceCacheDirs(): string[] {
  const env = process.env;
  const dirs: string[] = [];

  if (env.HUGGINGFACE_HUB_CACHE) dirs.push(env.HUGGINGFACE_HUB_CACHE);
  if (env.HF_HUB_CACHE) dirs.push(env.HF_HUB_CACHE);
  if (env.HF_HOME) dirs.push(join(env.HF_HOME, 'hub'));
  dirs.push(join(homedir(), '.cache', 'huggingface', 'hub'));

  return [...new Set(dirs)];
}

async function collect(
  directory: string,
  source: string,
  models: LocalModel[],
  seen: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      await collect(full, source, models, seen);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.gguf')) continue;
    if (!isUsableModelFile(entry.name)) continue;

    try {
      const real = await realpath(full);
      if (seen.has(real)) continue;

      const info = await stat(real);
      seen.add(real);
      models.push({
        path: full,
        name: entry.name.replace(/\.gguf$/i, ''),
        size: info.size,
        source,
      });
    } catch {
      // broken symlink
    }
  }
}

// Find GGUF files in the Hugging Face cache and any extra directories.
export async function scanLocalModels(extraDirs: string[] = []): Promise<LocalModel[]> {
  const models: LocalModel[] = [];
  const seen = new Set<string>();

  for (const directory of huggingFaceCacheDirs()) {
    await collect(directory, 'huggingface', models, seen);
  }
  for (const directory of extraDirs) {
    await collect(directory, 'local', models, seen);
  }

  return models.sort((a, b) => a.name.localeCompare(b.name));
}
