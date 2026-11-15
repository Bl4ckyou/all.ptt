import {
  buildSettingArgs,
  detectTarget,
  fetchReleases,
  readInstalledStates,
  readModelConfig,
  recommendBackend,
  resolveInstalledBinary,
  resolveSettings,
  selectAsset,
  toAssets,
  type BackendEntry,
} from '@ptt/backends';
import { OpenAICompatibleProvider } from '@ptt/providers';
import type { AppContext } from '../context.js';
import { readJson, sendError, sendJson } from '../http.js';
import type { Handler } from '../router.js';

function variantsFor(backend: BackendEntry): string[] {
  const supported = new Set<string>();
  for (const rule of backend.selection) {
    for (const key of rule.targets) {
      if (key.endsWith('-cuda')) supported.add('cuda');
      else if (key.endsWith('-vulkan')) supported.add('vulkan');
      else if (key.endsWith('-rocm')) supported.add('rocm');
      else if (key.includes('metal')) supported.add('metal');
      else if (key.endsWith('-cpu')) supported.add('cpu');
    }
  }
  return ['auto', ...['cpu', 'cuda', 'vulkan', 'rocm', 'metal'].filter((v) => supported.has(v))];
}

export function backendsRoute(context: AppContext): Handler {
  return async ({ res }) => {
    const target = detectTarget();
    const states = await readInstalledStates(context.root);

    const backends = Object.entries(context.manifest.backends).map(([id, backend]) => ({
      id,
      label: backend.label,
      shortLabel: backend.shortLabel ?? backend.label,
      repo: backend.repo,
      defaultVariant: backend.defaultVariant,
      variants: variantsFor(backend),
      installed: Object.values(states[id]?.variants ?? {}),
      kind: backend.kind ?? 'github',
      custom: backend.custom ?? false,
    }));

    sendJson(res, 200, {
      target,
      recommended: recommendBackend(target, context.manifest.defaults),
      backends,
      running: context.launcher.list(),
    });
  };
}

const latestCache = new Map<string, { at: number; latest: Record<string, string> }>();
const LATEST_TTL_MS = 10 * 60_000;

// Compare installed variants with the newest matching GitHub release.
export function backendLatestRoute(context: AppContext): Handler {
  return async ({ res }) => {
    const target = detectTarget();
    const states = await readInstalledStates(context.root);
    const latest: Record<string, Record<string, string>> = {};

    await Promise.all(
      Object.entries(states).map(async ([id, state]) => {
        const variants = Object.values(state.variants ?? {});
        if (variants.length === 0) return;

        const cached = latestCache.get(id);
        if (cached && Date.now() - cached.at < LATEST_TTL_MS) {
          latest[id] = cached.latest;
          return;
        }

        const backend = context.manifest.backends[id];
        if (!backend || backend.kind === 'local') return;

        let releases;
        try {
          releases = await fetchReleases(backend.repo, {
            token: process.env.GITHUB_TOKEN,
            perPage: 15,
          });
        } catch {
          return;
        }

        const assetContext = {
          cpu: target.cpu ?? 'avx2',
          cuda: target.gpu.cuda ?? '',
          os: target.os,
          arch: target.arch,
        };
        const tags: Record<string, string> = {};
        for (const variant of variants) {
          if (tags[variant.target]) continue;
          for (const release of releases) {
            const match = selectAsset(
              toAssets(release),
              backend.selection,
              [variant.target],
              assetContext,
            );
            if (match) {
              tags[variant.target] = release.tag_name;
              break;
            }
          }
        }

        latestCache.set(id, { at: Date.now(), latest: tags });
        latest[id] = tags;
      }),
    );

    sendJson(res, 200, { latest });
  };
}

export function backendSettingsRoute(context: AppContext): Handler {
  return async ({ url, res }) => {
    const id = url.searchParams.get('backendId') ?? '';
    const backend = context.manifest.backends[id];
    if (!backend) {
      sendError(res, 400, 'error.unknown_backend');
      return;
    }

    const resolved = await resolveInstalledBinary(context.root, id);
    const { settings, probed } = await resolveSettings(
      resolved?.record.binary ?? null,
      backend,
      context.manifest.settings,
    );

    const entries = settings.map(({ flag: _flag, invert: _invert, ...rest }) => rest);
    const locale = url.searchParams.get('locale') ?? 'en';

    // Only dynamic settings (without a curated i18n key) need machine translation.
    const dynamic: { entry: (typeof entries)[number]; field: 'label' | 'description' }[] = [];
    for (const entry of entries) {
      if (entry.descriptionKey) continue;
      if (entry.label) dynamic.push({ entry, field: 'label' });
      if (entry.description) dynamic.push({ entry, field: 'description' });
    }

    if (dynamic.length > 0) {
      const translated = await context.translation.translate(
        dynamic.map(({ entry, field }) => entry[field] as string),
        locale,
      );
      dynamic.forEach(({ entry, field }, index) => {
        entry[field] = translated[index];
      });
    }

    sendJson(res, 200, {
      probed,
      settings: entries,
      categorySpecTypes: backend.categorySpecTypes ?? {},
    });
  };
}

interface InstallBody {
  id?: string;
  variant?: string;
  version?: string;
}

export function installBackendRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: InstallBody;
    try {
      body = await readJson<InstallBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const backend = body.id ? context.manifest.backends[body.id] : undefined;
    if (!body.id || !backend) {
      sendError(res, 400, 'error.unknown_backend');
      return;
    }
    if (backend.kind === 'local') {
      sendError(res, 400, 'error.local_backend');
      return;
    }

    const job = context.jobs.startBackends(
      'install',
      [{ id: body.id, label: backend.label, variant: body.variant, version: body.version }],
      {
        root: context.root,
        target: detectTarget(),
        backends: context.manifest.backends,
        token: process.env.GITHUB_TOKEN,
      },
    );
    sendJson(res, 202, job);
  };
}

interface UpdateBody {
  id?: string;
}

export function updateBackendsRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: UpdateBody = {};
    try {
      body = await readJson<UpdateBody>(req);
    } catch {
      // an empty body means "update everything"
    }

    const ids = body.id ? [body.id] : Object.keys(context.manifest.backends);
    const items = ids
      .filter((id) => context.manifest.backends[id]?.kind !== 'local')
      .map((id) => ({
        id,
        label: context.manifest.backends[id]?.label ?? id,
      }));

    const job = context.jobs.startBackends('update', items, {
      root: context.root,
      target: detectTarget(),
      backends: context.manifest.backends,
      token: process.env.GITHUB_TOKEN,
    });
    sendJson(res, 202, job);
  };
}

export function jobRoute(context: AppContext): Handler {
  return ({ params, res }) => {
    const job = context.jobs.get(params.id);
    if (!job) {
      sendError(res, 404, 'not_found');
      return;
    }
    sendJson(res, 200, job);
  };
}

function jobActionRoute(
  context: AppContext,
  action: 'pause' | 'resume' | 'cancel',
): Handler {
  return ({ params, res }) => {
    const job = context.jobs[action](params.id);
    if (!job) {
      sendError(res, 404, 'not_found');
      return;
    }
    sendJson(res, 200, job);
  };
}

export const pauseJobRoute = (context: AppContext): Handler =>
  jobActionRoute(context, 'pause');
export const resumeJobRoute = (context: AppContext): Handler =>
  jobActionRoute(context, 'resume');
export const cancelJobRoute = (context: AppContext): Handler =>
  jobActionRoute(context, 'cancel');

interface LaunchBody {
  backendId?: string;
  modelPath?: string;
  port?: number;
}

export function launchBackendRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: LaunchBody;
    try {
      body = await readJson<LaunchBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    if (!body.modelPath || !body.modelPath.toLowerCase().endsWith('.gguf')) {
      sendError(res, 400, 'error.bad_model');
      return;
    }

    try {
      const resolved = await resolveInstalledBinary(context.root, body.backendId);
      if (!resolved) {
        sendJson(res, 400, { error: 'error.not_installed' });
        return;
      }

      const backendId = resolved.backendId;
      const backend = context.manifest.backends[backendId];
      const config = await readModelConfig(context.root, body.modelPath);
      const extraArgs = backend
        ? buildSettingArgs(
            backend,
            context.manifest.settings,
            config?.settings ?? {},
            config?.extraArgs ?? '',
          )
        : [];

      const run = await context.launcher.launch({
        backendId,
        modelPath: body.modelPath,
        port: body.port,
        extraArgs,
        local: backend?.local,
      });

      context.registry.add(
        new OpenAICompatibleProvider({
          id: run.providerId,
          baseUrl: `http://127.0.0.1:${run.port}/v1`,
        }),
      );

      sendJson(res, 200, {
        providerId: run.providerId,
        backendId: run.backendId,
        port: run.port,
        modelPath: run.modelPath,
        extraArgs,
      });
    } catch (error) {
      sendJson(res, 500, { error: 'error.launch', message: (error as Error).message });
    }
  };
}

interface StopBody {
  providerId?: string;
}

export function stopBackendRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: StopBody;
    try {
      body = await readJson<StopBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    if (!body.providerId) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const stopped = context.launcher.stop(body.providerId);
    context.registry.remove(body.providerId);
    sendJson(res, 200, { stopped });
  };
}
