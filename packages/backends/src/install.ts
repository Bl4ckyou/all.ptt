import { existsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { extractArchive } from './archive.js';
import { writeJsonFile } from './json-file.js';
import { variantTargets } from './detect.js';
import { findBinary, makeExecutable } from './find-binary.js';
import { fetchReleaseByTag, fetchReleases, toAssets, type GithubRelease } from './github.js';
import { selectAsset, type AssetSelection } from './select.js';
import {
  backendDir,
  installedStatePath,
  readInstalledState,
} from './state.js';
import type {
  BackendEntry,
  InstalledState,
  InstalledVariant,
  ReleaseAsset,
  SyncRecord,
  SyncResult,
  Target,
} from './types.js';

export { formatBytes } from '@ptt/core';

export interface DownloadControl {
  wait(): Promise<void>;
  readonly cancelled: boolean;
}

export type SyncPhase = 'checking' | 'downloading' | 'extracting';

export interface SyncProgress {
  phase: SyncPhase;
  asset?: string;
  downloaded: number;
  total: number;
}

async function download(
  url: string,
  destination: string,
  options: {
    signal?: AbortSignal;
    control?: DownloadControl;
    onProgress?: (downloaded: number, total: number) => void;
  } = {},
): Promise<void> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'ptt-backend-installer' },
    signal: options.signal,
  });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);

  await mkdir(dirname(destination), { recursive: true });

  const stream = createWriteStream(destination);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  let downloaded = 0;

  options.onProgress?.(0, total);

  try {
    while (true) {
      await options.control?.wait();
      if (options.control?.cancelled) throw new Error('cancelled');

      const { value, done } = await reader.read();
      if (done) break;

      downloaded += value.byteLength;
      if (!stream.write(Buffer.from(value))) await once(stream, 'drain');
      options.onProgress?.(downloaded, total);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    reader.releaseLock();
  }
}

export async function cachedArchive(path: string, size: number): Promise<boolean> {
  if (size <= 0) return false;
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}

export function splitList(value: string | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function selectedVariantNames(state: InstalledState): string[] {
  const names = Object.values(state.variants)
    .map((record) => record.variant)
    .filter((variant) => variant && variant !== 'legacy');
  return [...new Set(names)];
}

interface Request {
  variant: string;
  candidates: string[];
}

function buildRequests(options: {
  backend: BackendEntry;
  target: Target;
  variants: string[];
  mode: 'install' | 'update';
  state: InstalledState;
}): Request[] {
  const { backend, target, variants, mode, state } = options;

  if (mode === 'update') {
    return Object.values(state.variants).map((record) => ({
      variant: record.variant ?? 'auto',
      candidates: [record.target],
    }));
  }

  const names = variants.length > 0
    ? variants
    : (selectedVariantNames(state).length > 0
        ? selectedVariantNames(state)
        : [backend.defaultVariant ?? 'auto']);

  return names.map((variant) => {
    const candidates = variantTargets(variant, target);
    if (candidates.length === 0) {
      throw new Error(`variant "${variant}" is not supported on ${target.os}/${target.arch}`);
    }
    return { variant, candidates };
  });
}

interface ChosenRelease extends AssetSelection {
  release: GithubRelease;
}

async function chooseRelease(
  backend: BackendEntry,
  candidates: string[],
  target: Target,
  version: string | undefined,
  token: string | undefined,
): Promise<ChosenRelease | null> {
  const context: Record<string, string> = {
    cpu: target.cpu ?? 'avx2',
    cuda: target.gpu.cuda ?? '',
    os: target.os,
    arch: target.arch,
  };

  const releases = version
    ? [await fetchReleaseByTag(backend.repo, version, { token })]
    : await fetchReleases(backend.repo, { token });

  for (const release of releases) {
    const match = selectAsset(toAssets(release), backend.selection, candidates, context);
    if (match) return { release, ...match };
  }
  return null;
}

// Remove old tags and variants that are no longer selected.
async function prune(directory: string, desired: Map<string, { tag: string }>): Promise<void> {
  if (!existsSync(directory)) return;

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name === '.download') continue;
    if (entry.name.startsWith('.')) {
      await rm(join(directory, entry.name), { recursive: true, force: true });
      continue;
    }

    const record = desired.get(entry.name);
    if (!record) {
      await rm(join(directory, entry.name), { recursive: true, force: true });
      continue;
    }

    const versionDirs = await readdir(join(directory, entry.name), { withFileTypes: true });
    for (const versionDir of versionDirs) {
      if (versionDir.isDirectory() && versionDir.name !== record.tag) {
        await rm(join(directory, entry.name, versionDir.name), { recursive: true, force: true });
      }
    }
  }
}

// Keep only the archives that are still referenced by the installed state.
async function pruneDownloads(directory: string, keep: Set<string>): Promise<void> {
  const downloadDir = join(directory, '.download');
  if (!existsSync(downloadDir)) return;

  const entries = await readdir(downloadDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!keep.has(entry.name)) {
      await rm(join(downloadDir, entry.name), { recursive: true, force: true });
    }
  }
}

export interface SyncOptions {
  id: string;
  backend: BackendEntry;
  target: Target;
  root: string;
  variants?: string[];
  mode?: 'install' | 'update';
  version?: string;
  force?: boolean;
  dryRun?: boolean;
  token?: string;
  signal?: AbortSignal;
  control?: DownloadControl;
  onProgress?: (progress: SyncProgress) => void;
}

export async function syncBackend(options: SyncOptions): Promise<SyncResult> {
  const { id, backend, target, root } = options;
  const variants = options.variants ?? [];
  const mode = options.mode ?? 'install';
  const state = await readInstalledState(root, id);
  const requests = buildRequests({ backend, target, variants, mode, state });

  if (requests.length === 0) {
    return { id, skipped: true, reason: 'nothing installed', records: [] };
  }

  const desired = new Map<string, { tag: string }>();
  const records: SyncRecord[] = [];

  options.onProgress?.({ phase: 'checking', downloaded: 0, total: 0 });

  for (const request of requests) {
    const selected = await chooseRelease(
      backend,
      request.candidates,
      target,
      options.version,
      options.token,
    );
    if (!selected) {
      throw new Error(
        `no matching asset for ${id} (${request.variant}) on ${request.candidates.join(', ')}`,
      );
    }

    const tag = selected.release.tag_name;
    const targetKey = selected.target;
    const previous = state.variants[targetKey];

    const runtimeMatches = !selected.runtime || previous?.runtime === selected.runtime.name;

    if (
      !options.force &&
      previous &&
      !previous.legacy &&
      previous.tag === tag &&
      runtimeMatches &&
      existsSync(previous.binary)
    ) {
      desired.set(targetKey, previous);
      records.push({ ...previous, skipped: true });
      continue;
    }

    const record: SyncRecord = {
      variant: request.variant,
      target: targetKey,
      tag,
      asset: selected.asset.name,
      size: selected.asset.size,
      runtime: selected.runtime?.name,
      installedAt: new Date().toISOString(),
    };

    if (options.dryRun) {
      desired.set(targetKey, { tag });
      records.push({ ...record, binary: previous?.binary ?? null, dryRun: true });
      continue;
    }

    const directory = backendDir(root, id);
    const versionDir = join(directory, targetKey, tag);
    const assets = selected.runtime ? [selected.asset, selected.runtime] : [selected.asset];
    const downloadedPaths: string[] = [];

    await rm(versionDir, { recursive: true, force: true });

    try {
      for (const asset of assets) {
        const archivePath = join(directory, '.download', asset.name);
        const cached = await cachedArchive(archivePath, asset.size);

        options.onProgress?.({
          phase: 'downloading',
          asset: asset.name,
          downloaded: cached ? asset.size : 0,
          total: asset.size,
        });

        if (!cached) {
          downloadedPaths.push(archivePath);
          await download(asset.url, archivePath, {
            signal: options.signal,
            control: options.control,
            onProgress: (downloaded, total) =>
              options.onProgress?.({
                phase: 'downloading',
                asset: asset.name,
                downloaded,
                total: total || asset.size,
              }),
          });
        }

        options.onProgress?.({
          phase: 'extracting',
          asset: asset.name,
          downloaded: asset.size,
          total: asset.size,
        });

        await extractArchive(archivePath, versionDir);
      }
    } catch (error) {
      await Promise.all(
        downloadedPaths.map((path) => rm(path, { force: true }).catch(() => undefined)),
      );
      await rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    const binary = await findBinary(versionDir, backend.binaries);
    if (!binary) throw new Error(`server binary not found in ${selected.asset.name}`);
    await makeExecutable(binary, target.os);

    const installed: InstalledVariant = {
      variant: request.variant,
      target: targetKey,
      tag,
      asset: selected.asset.name,
      size: selected.asset.size,
      runtime: selected.runtime?.name,
      installedAt: new Date().toISOString(),
      binary,
    };

    state.variants[targetKey] = installed;
    desired.set(targetKey, installed);
    records.push(installed);
  }

  if (options.dryRun) return { id, records, dryRun: true };

  for (const key of Object.keys(state.variants)) {
    if (!desired.has(key)) delete state.variants[key];
  }

  const directory = backendDir(root, id);
  await mkdir(directory, { recursive: true });
  await writeJsonFile(installedStatePath(root, id), state);

  const keep = new Set<string>();
  for (const variant of Object.values(state.variants)) {
    keep.add(variant.asset);
    if (variant.runtime) keep.add(variant.runtime);
  }

  await prune(directory, desired);
  await pruneDownloads(directory, keep);

  return { id, records };
}

export type { ReleaseAsset };
