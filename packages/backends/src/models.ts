import { realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { classifyGguf, readGgufSignature, type GgufCategory } from './gguf.js';

export type GgufKind = 'model' | 'mmproj' | 'mtp' | 'other';

export interface LocalModel {
  path: string;
  name: string;
  size: number;
  source: string;
  category?: GgufCategory;
  architecture?: string | null;
  blockCount?: number | null;
  embeddingLength?: number | null;
  contextLength?: number | null;
}

export interface AuxiliaryFile extends LocalModel {
  kind: 'mmproj' | 'mtp';
}

type ScannedKind = 'model' | 'mmproj' | 'draft';

interface ScannedFile extends LocalModel {
  kind: ScannedKind;
}

export function ggufKind(fileName: string): GgufKind {
  if (!fileName.toLowerCase().endsWith('.gguf')) return 'other';

  const base = fileName.replace(/\.gguf$/i, '');
  if (/(^|[-_.])mmproj([-_.]|$)/i.test(base)) return 'mmproj';
  if (/(^|[-_.])mtp([-_.]|$)/i.test(base)) return 'mtp';

  const split = /-(\d{5})-of-(\d{5})$/i.exec(base);
  if (split && split[1] !== '00001') return 'other';

  return 'model';
}

export function isUsableModelFile(fileName: string): boolean {
  return ggufKind(fileName) === 'model';
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
  files: ScannedFile[],
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
      await collect(full, source, files, seen);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.gguf')) continue;

    const split = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(entry.name);
    if (split && split[1] !== '00001') continue;

    try {
      const real = await realpath(full);
      if (seen.has(real)) continue;

      const info = await stat(real);
      seen.add(real);

      let signature = null;
      try {
        signature = await readGgufSignature(full);
      } catch {
        signature = null;
      }
      const classification = classifyGguf(entry.name, signature);

      const kind: ScannedKind =
        classification.kind === 'mmproj'
          ? 'mmproj'
          : classification.category !== 'other'
            ? 'draft'
            : 'model';

      files.push({
        path: full,
        name: entry.name.replace(/\.gguf$/i, ''),
        size: info.size,
        source,
        kind,
        architecture: signature?.architecture ?? null,
        blockCount: signature?.blockCount ?? null,
        embeddingLength: signature?.embeddingLength ?? null,
        contextLength: signature?.contextLength ?? null,
        ...(kind === 'draft' ? { category: classification.category } : {}),
      });
    } catch {
      // broken symlink
    }
  }
}

export interface LocalFiles {
  models: LocalModel[];
  drafts: LocalModel[];
  auxiliary: AuxiliaryFile[];
}

// Scan the Hugging Face cache and extra directories once, classifying files.
export async function scanLocalFiles(extraDirs: string[] = []): Promise<LocalFiles> {
  const files: ScannedFile[] = [];
  const seen = new Set<string>();

  for (const directory of huggingFaceCacheDirs()) {
    await collect(directory, 'huggingface', files, seen);
  }
  for (const directory of extraDirs) {
    await collect(directory, 'local', files, seen);
  }

  const models = files
    .filter((file) => file.kind === 'model')
    .map(({ kind: _kind, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));

  const drafts = files
    .filter((file) => file.kind === 'draft')
    .map(({ kind: _kind, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));

  const auxiliary = files
    .filter((file) => file.kind === 'mmproj')
    .map(({ kind: _kind, category: _category, ...rest }) => ({ ...rest, kind: 'mmproj' as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { models, drafts, auxiliary };
}

export async function scanLocalModels(extraDirs: string[] = []): Promise<LocalModel[]> {
  return (await scanLocalFiles(extraDirs)).models;
}

export async function scanAuxiliaryFiles(extraDirs: string[] = []): Promise<AuxiliaryFile[]> {
  return (await scanLocalFiles(extraDirs)).auxiliary;
}

// Existing directories that may contain models, for "open folder" actions.
export async function listModelDirectories(extraDirs: string[] = []): Promise<string[]> {
  const candidates = [...new Set([...huggingFaceCacheDirs(), ...extraDirs])];
  const existing: string[] = [];

  for (const directory of candidates) {
    try {
      if ((await stat(directory)).isDirectory()) existing.push(directory);
    } catch {
      // missing directory
    }
  }
  return existing;
}
