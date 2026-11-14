import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractArchive } from './archive.mjs';
import { variantTargets } from './detect.mjs';
import { findBinary, makeExecutable } from './find-binary.mjs';
import { fetchReleaseByTag, fetchReleases, toAssets } from './github.mjs';
import { selectAsset } from './select.mjs';

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'ptt-backend-installer' } });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);

  await mkdir(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function emptyState(backend) {
  return { backend, variants: {} };
}

async function readState(path, backend) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    if (raw?.variants) return { backend, variants: raw.variants };
    if (raw?.target) {
      // migrate the legacy single-record format; force a fresh install
      return {
        backend,
        variants: { [raw.target]: { ...raw, variant: raw.variant ?? 'auto', legacy: true } },
      };
    }
  } catch {
    // no state yet
  }
  return emptyState(backend);
}

async function writeState(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function splitList(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function selectedVariantNames(state) {
  const names = Object.values(state.variants)
    .map((record) => record.variant)
    .filter((variant) => variant && variant !== 'legacy');
  return [...new Set(names)];
}

function buildRequests({ backend, target, variants, mode, state }) {
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

async function chooseRelease(backend, candidates, target, version, token) {
  const context = {
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
async function prune(installDir, desired) {
  if (!existsSync(installDir)) return;

  const entries = await readdir(installDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith('.')) {
      await rm(join(installDir, entry.name), { recursive: true, force: true });
      continue;
    }

    const record = desired.get(entry.name);
    if (!record) {
      await rm(join(installDir, entry.name), { recursive: true, force: true });
      continue;
    }

    const versionDirs = await readdir(join(installDir, entry.name), { withFileTypes: true });
    for (const versionDir of versionDirs) {
      if (versionDir.isDirectory() && versionDir.name !== record.tag) {
        await rm(join(installDir, entry.name, versionDir.name), { recursive: true, force: true });
      }
    }
  }
}

export async function syncBackend({
  id,
  backend,
  target,
  root,
  variants = [],
  mode = 'install',
  version,
  force,
  dryRun,
  token,
}) {
  const installDir = join(root, '.backends', id);
  const statePath = join(installDir, 'installed.json');
  const state = await readState(statePath, id);
  const requests = buildRequests({ backend, target, variants, mode, state });

  if (requests.length === 0) {
    return { id, skipped: true, reason: 'nothing installed', records: [] };
  }

  const desired = new Map();
  const results = [];

  for (const request of requests) {
    const selected = await chooseRelease(backend, request.candidates, target, version, token);
    if (!selected) {
      throw new Error(
        `no matching asset for ${id} (${request.variant}) on ${request.candidates.join(', ')}`,
      );
    }

    const tag = selected.release.tag_name;
    const targetKey = selected.target;
    const previous = state.variants[targetKey];

    if (!force && previous && !previous.legacy && previous.tag === tag && existsSync(previous.binary)) {
      desired.set(targetKey, previous);
      results.push({ ...previous, skipped: true });
      continue;
    }

    const record = {
      variant: request.variant,
      target: targetKey,
      tag,
      asset: selected.asset.name,
      size: selected.asset.size,
      installedAt: new Date().toISOString(),
    };

    if (dryRun) {
      desired.set(targetKey, record);
      results.push({ ...record, binary: previous?.binary ?? null, dryRun: true });
      continue;
    }

    const versionDir = join(installDir, targetKey, tag);
    const archivePath = join(installDir, '.download', selected.asset.name);

    await rm(versionDir, { recursive: true, force: true });
    await download(selected.asset.url, archivePath);
    await extractArchive(archivePath, versionDir);

    const binary = await findBinary(versionDir, backend.binaries);
    if (!binary) throw new Error(`server binary not found in ${selected.asset.name}`);
    await makeExecutable(binary, target.os);

    record.binary = binary;
    state.variants[targetKey] = record;
    desired.set(targetKey, record);
    results.push(record);
  }

  if (dryRun) return { id, records: results, dryRun: true };

  for (const key of Object.keys(state.variants)) {
    if (!desired.has(key)) delete state.variants[key];
  }

  await mkdir(installDir, { recursive: true });
  await writeState(statePath, state);
  await prune(installDir, desired);

  return { id, records: results };
}

export function formatBytes(bytes) {
  if (!bytes) return 'unknown size';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
