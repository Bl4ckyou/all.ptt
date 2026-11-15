import { stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import {
  clearInstalledState,
  detectTarget,
  fetchReleaseByTag,
  fetchReleases,
  toAssets,
  writeInstalledState,
  type BackendEntry,
  type ReleaseAsset,
} from '@ptt/backends';
import type { AppContext } from '../context.js';
import { readCustomBackends, writeCustomBackends } from '../custom-backends.js';
import { readJson, sendError, sendJson } from '../http.js';
import type { Handler } from '../router.js';
import { isSafeId } from '../validation.js';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function token(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

function assetPattern(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${escaped.replace(/\d+/g, '.*')}$`;
}

function labelOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label.length > 0 && label.length <= 80 ? label : null;
}

interface LocalBody {
  id?: string;
  label?: string;
  path?: string;
  baseArgs?: string[];
  health?: string;
  modelArg?: string;
}

export function addLocalBackendRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: LocalBody;
    try {
      body = await readJson<LocalBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const id = body.id;
    const label = labelOf(body.label);
    if (!isSafeId(id) || !label || !body.path || !isAbsolute(body.path)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }
    if (context.manifest.backends[id]) {
      sendError(res, 409, 'error.backend_exists');
      return;
    }

    const info = await stat(body.path).catch(() => null);
    if (!info?.isFile()) {
      sendError(res, 400, 'error.bad_binary');
      return;
    }

    const entry: BackendEntry = {
      label,
      shortLabel: label,
      repo: 'local',
      defaultVariant: 'auto',
      binaries: [basename(body.path)],
      selection: [],
      settings: {},
      kind: 'local',
      custom: true,
      local: {
        binary: body.path,
        baseArgs: Array.isArray(body.baseArgs) ? body.baseArgs.filter((arg) => typeof arg === 'string') : undefined,
        health: typeof body.health === 'string' ? body.health : undefined,
        modelArg: typeof body.modelArg === 'string' ? body.modelArg : undefined,
      },
    };

    const store = await readCustomBackends(context.root);
    store.backends[id] = entry;
    await writeCustomBackends(context.root, store);

    context.manifest.backends[id] = entry;
    await writeInstalledState(context.root, id, {
      backend: id,
      variants: {
        local: {
          variant: 'auto',
          target: 'local',
          tag: 'local',
          asset: 'local',
          size: 0,
          installedAt: new Date().toISOString(),
          binary: body.path,
        },
      },
    });

    sendJson(res, 200, { id });
  };
}

export function browseBackendReleasesRoute(_context: AppContext): Handler {
  return async ({ url, res }) => {
    const repo = url.searchParams.get('repo') ?? '';
    if (!REPO.test(repo)) {
      sendError(res, 400, 'error.bad_repo');
      return;
    }

    try {
      const releases = await fetchReleases(repo, { token: token(), perPage: 5 });
      sendJson(res, 200, {
        releases: releases.map((release) => ({
          tag: release.tag_name,
          assets: toAssets(release).map((asset) => ({
            name: asset.name,
            size: asset.size,
          })),
        })),
      });
    } catch {
      sendError(res, 400, 'error.bad_repo');
    }
  };
}

interface GithubBody {
  id?: string;
  label?: string;
  repo?: string;
  tag?: string;
  asset?: string;
  binaryName?: string;
}

export function addGithubBackendRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: GithubBody;
    try {
      body = await readJson<GithubBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const id = body.id;
    const label = labelOf(body.label);
    const repo = body.repo ?? '';
    if (!isSafeId(id) || !label || !REPO.test(repo) || !body.asset) {
      sendError(res, 400, 'error.bad_request');
      return;
    }
    if (context.manifest.backends[id]) {
      sendError(res, 409, 'error.backend_exists');
      return;
    }

    let assets: ReleaseAsset[];
    try {
      const release = body.tag
        ? await fetchReleaseByTag(repo, body.tag, { token: token() })
        : (await fetchReleases(repo, { token: token(), perPage: 1 }))[0];
      if (!release) {
        sendError(res, 400, 'error.bad_repo');
        return;
      }
      assets = toAssets(release);
    } catch {
      sendError(res, 400, 'error.bad_repo');
      return;
    }

    const chosen = assets.find((asset) => asset.name === body.asset);
    if (!chosen) {
      sendError(res, 400, 'error.bad_asset');
      return;
    }

    const binaryName = body.binaryName?.trim() || 'llama-server';
    const entry: BackendEntry = {
      label,
      shortLabel: label,
      repo,
      defaultVariant: 'auto',
      binaries: [...new Set([binaryName, 'llama-server', 'llama-server.exe'])],
      selection: [
        {
          targets: detectTarget().targets.slice(0, 1),
          include: assetPattern(chosen.name),
        },
      ],
      settings: {},
      kind: 'github',
      custom: true,
    };

    const store = await readCustomBackends(context.root);
    store.backends[id] = entry;
    await writeCustomBackends(context.root, store);
    context.manifest.backends[id] = entry;

    sendJson(res, 200, { id });
  };
}

export function removeCustomBackendRoute(context: AppContext): Handler {
  return async ({ params, res }) => {
    const id = params.id;
    const backend = isSafeId(id) ? context.manifest.backends[id] : undefined;
    if (!id || !backend?.custom) {
      sendError(res, 404, 'error.unknown_backend');
      return;
    }

    const store = await readCustomBackends(context.root);
    delete store.backends[id];
    await writeCustomBackends(context.root, store);
    delete context.manifest.backends[id];
    await clearInstalledState(context.root, id);

    sendJson(res, 200, { id });
  };
}
