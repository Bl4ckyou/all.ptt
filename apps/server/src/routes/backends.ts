import {
  buildSettingArgs,
  detectTarget,
  readInstalledStates,
  readModelConfig,
  recommendBackend,
  resolveInstalledBinary,
  resolveSettings,
  syncBackend,
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
      repo: backend.repo,
      defaultVariant: backend.defaultVariant,
      variants: variantsFor(backend),
      installed: Object.values(states[id]?.variants ?? {}),
    }));

    sendJson(res, 200, {
      target,
      recommended: recommendBackend(target, context.manifest.defaults),
      backends,
      running: context.launcher.list(),
    });
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

    sendJson(res, 200, {
      probed,
      settings: settings.map(({ flag: _flag, invert: _invert, ...rest }) => rest),
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

    try {
      const result = await syncBackend({
        id: body.id,
        backend,
        target: detectTarget(),
        root: context.root,
        variants: body.variant ? [body.variant] : [],
        mode: 'install',
        version: body.version,
        token: process.env.GITHUB_TOKEN,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: 'error.backend', message: (error as Error).message });
    }
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
    const results: unknown[] = [];

    for (const id of ids) {
      const backend = context.manifest.backends[id];
      if (!backend) {
        results.push({ id, error: 'error.unknown_backend' });
        continue;
      }
      try {
        results.push(
          await syncBackend({
            id,
            backend,
            target: detectTarget(),
            root: context.root,
            mode: 'update',
            token: process.env.GITHUB_TOKEN,
          }),
        );
      } catch (error) {
        results.push({ id, error: (error as Error).message });
      }
    }

    sendJson(res, 200, { results });
  };
}

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
