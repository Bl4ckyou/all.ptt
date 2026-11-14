import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractArchive } from './archive.mjs';
import { findBinary, makeExecutable } from './find-binary.mjs';
import { fetchReleaseByTag, fetchReleases, toAssets } from './github.mjs';
import { selectAsset } from './select.mjs';

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'ptt-backend-installer' } });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);

  await mkdir(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function readMarker(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (!bytes) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function chooseRelease(backend, target, version, token) {
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
    const match = selectAsset(toAssets(release), backend.selection, target.targets, context);
    if (match) return { release, ...match };
  }
  return null;
}

export async function installBackend({ id, backend, target, root, version, force, dryRun, token }) {
  const installDir = join(root, '.backends', id);
  const markerPath = join(installDir, 'installed.json');
  const existing = await readMarker(markerPath);

  const selected = await chooseRelease(backend, target, version, token);
  if (!selected) {
    throw new Error(`no matching asset for ${id} on ${target.targets.join(', ') || 'unsupported platform'}`);
  }

  const tag = selected.release.tag_name;
  const ready = existing && existing.tag === tag && existsSync(existing.binary);
  if (ready && !force) return { ...existing, skipped: true };

  const result = {
    backend: id,
    tag,
    asset: selected.asset.name,
    target: selected.target,
    size: selected.asset.size,
  };

  if (dryRun) return { ...result, dryRun: true };

  const versionDir = join(installDir, tag);
  const archivePath = join(installDir, selected.asset.name);

  await rm(versionDir, { recursive: true, force: true });
  await download(selected.asset.url, archivePath);
  await extractArchive(archivePath, versionDir);
  await rm(archivePath, { force: true });

  const binary = await findBinary(versionDir, backend.binaries);
  if (!binary) throw new Error(`server binary not found in ${selected.asset.name}`);
  await makeExecutable(binary, target.os);

  const record = { ...result, binary, installedAt: new Date().toISOString() };
  await writeFile(markerPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export { formatBytes };
