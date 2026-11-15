import { realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from './json-file.js';
import {
  classifyGguf,
  isTextModel,
  quantizationOf,
  readGgufSignature,
  type GgufCategory,
} from './gguf.js';

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
  quantization?: string | null;
  hasMtp?: boolean;
  chatTemplate?: string | null;
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

export function huggingFaceHubDir(): string {
  const env = process.env;
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
  if (env.HUGGINGFACE_HUB_CACHE) return env.HUGGINGFACE_HUB_CACHE;
  if (env.HF_HOME) return join(env.HF_HOME, 'hub');
  return join(homedir(), '.cache', 'huggingface', 'hub');
}

function huggingFaceCacheDirs(): string[] {
  const env = process.env;
  const dirs: string[] = [huggingFaceHubDir()];

  if (env.HUGGINGFACE_HUB_CACHE) dirs.push(env.HUGGINGFACE_HUB_CACHE);
  if (env.HF_HUB_CACHE) dirs.push(env.HF_HUB_CACHE);
  if (env.HF_HOME) dirs.push(join(env.HF_HOME, 'hub'));

  return [...new Set(dirs)];
}

interface IndexedFile {
  mtimeMs: number;
  size: number;
  file?: ScannedFile;
  ignored?: boolean;
}

let scanIndexPath = join(process.cwd(), '.ptt', 'model-scan.json');
let scanIndex: Map<string, IndexedFile> | null = null;
let scanIndexPromise: Promise<Map<string, IndexedFile>> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

export function setModelScanIndex(path: string): void {
  scanIndexPath = path;
  scanIndex = null;
  scanIndexPromise = null;
}

async function loadScanIndex(): Promise<Map<string, IndexedFile>> {
  if (scanIndex) return scanIndex;
  if (!scanIndexPromise) {
    scanIndexPromise = readJsonFile<Record<string, IndexedFile>>(scanIndexPath)
      .then((value) => {
        scanIndex = new Map(Object.entries(value ?? {}));
        return scanIndex;
      })
      .catch(() => {
        scanIndex = new Map();
        return scanIndex;
      });
  }
  return scanIndexPromise;
}

function scheduleIndexSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!scanIndex) return;
    void writeJsonFile(scanIndexPath, Object.fromEntries(scanIndex)).catch(() => undefined);
  }, 250);
  saveTimer.unref?.();
}

async function collect(
  directory: string,
  source: string,
  files: ScannedFile[],
  seen: Set<string>,
  index: Map<string, IndexedFile>,
  visitedDirs: Set<string>,
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
      if (source === 'huggingface' && (entry.name === 'blobs' || entry.name === '.locks')) {
        continue;
      }
      await collect(full, source, files, seen, index, visitedDirs);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const info = await stat(full).catch(() => null);
      if (info?.isDirectory()) {
        const realDir = await realpath(full).catch(() => null);
        if (realDir && !visitedDirs.has(realDir)) {
          visitedDirs.add(realDir);
          await collect(full, source, files, seen, index, visitedDirs);
        }
        continue;
      }
    }

    if (!entry.name.toLowerCase().endsWith('.gguf')) continue;

    const split = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(entry.name);
    if (split && split[1] !== '00001') continue;

    try {
      const real = await realpath(full);
      if (seen.has(real)) continue;

      const info = await stat(real);
      seen.add(real);

      const cached = index.get(real);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        if (cached.ignored || !cached.file) continue;
        files.push({ ...cached.file, path: full });
        continue;
      }

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

      // Cache non-text GGUFs too, otherwise they are re-parsed on every scan.
      if (kind === 'model' && !isTextModel(signature)) {
        index.set(real, { mtimeMs: info.mtimeMs, size: info.size, ignored: true });
        scheduleIndexSave();
        continue;
      }

      const scanned: ScannedFile = {
        path: full,
        name: entry.name.replace(/\.gguf$/i, ''),
        size: info.size,
        source,
        kind,
        architecture: signature?.architecture ?? null,
        blockCount: signature?.blockCount ?? null,
        embeddingLength: signature?.embeddingLength ?? null,
        contextLength: signature?.contextLength ?? null,
        quantization: quantizationOf(entry.name, signature),
        hasMtp: signature?.hasMtp ?? false,
        chatTemplate: signature?.chatTemplate ?? null,
        ...(kind === 'draft' ? { category: classification.category } : {}),
      };
      files.push(scanned);
      index.set(real, { mtimeMs: info.mtimeMs, size: info.size, file: scanned });
      scheduleIndexSave();
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

let scanCache: { key: string; expires: number; value: LocalFiles } | null = null;
let inflightScan: { key: string; promise: Promise<LocalFiles> } | null = null;

export function clearModelScanCache(): void {
  scanCache = null;
  inflightScan = null;
}

async function performScan(extraDirs: string[]): Promise<LocalFiles> {
  const files: ScannedFile[] = [];
  const seen = new Set<string>();
  const visitedDirs = new Set<string>();
  const index = await loadScanIndex();

  for (const directory of huggingFaceCacheDirs()) {
    const real = await realpath(directory).catch(() => directory);
    visitedDirs.add(real);
    await collect(directory, 'huggingface', files, seen, index, visitedDirs);
  }
  for (const directory of extraDirs) {
    const real = await realpath(directory).catch(() => directory);
    visitedDirs.add(real);
    await collect(directory, 'local', files, seen, index, visitedDirs);
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

// Scan the Hugging Face cache and extra directories once, classifying files.
// Cached results are returned immediately while a refresh runs in the background.
export async function scanLocalFiles(extraDirs: string[] = []): Promise<LocalFiles> {
  const key = JSON.stringify(extraDirs);
  if (scanCache && scanCache.key === key && scanCache.expires > Date.now()) {
    return scanCache.value;
  }

  if (inflightScan && inflightScan.key === key) {
    return scanCache && scanCache.key === key ? scanCache.value : inflightScan.promise;
  }

  let promise: Promise<LocalFiles>;
  promise = performScan(extraDirs)
    .then((value) => {
      scanCache = { key, expires: Date.now() + 60_000, value };
      return value;
    })
    .finally(() => {
      if (inflightScan?.promise === promise) inflightScan = null;
    });
  inflightScan = { key, promise };

  // Stale-while-revalidate: never make the UI wait for a re-scan.
  if (scanCache && scanCache.key === key) return scanCache.value;
  return promise;
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
