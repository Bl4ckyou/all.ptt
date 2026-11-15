import { dirname, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { listModelDirectories, readGgufInfo, revealPath, scanLocalFiles } from '@ptt/backends';
import type { AppContext } from '../context.js';
import { readJson, sendError, sendJson } from '../http.js';
import { refreshQuantTypes } from '../quant-types.js';
import type { Handler } from '../router.js';
import { isGgufPath, isWithin } from '../validation.js';

export function localModelsRoute(context: AppContext): Handler {
  return async ({ url, res }) => {
    await refreshQuantTypes(context.root);
    const force = url.searchParams.get('refresh') === '1';
    const [files, directories] = await Promise.all([
      scanLocalFiles(context.modelDirs, { force }),
      listModelDirectories(context.modelDirs),
    ]);
    sendJson(res, 200, {
      models: files.models,
      drafts: files.drafts,
      auxiliary: files.auxiliary,
      directories,
    });
  };
}

export function modelInfoRoute(context: AppContext): Handler {
  return async ({ url, res }) => {
    const path = url.searchParams.get('path');
    if (!isGgufPath(path)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const allowed = await listModelDirectories(context.modelDirs);
    if (!allowed.some((base) => isWithin(dirname(path), base))) {
      sendError(res, 403, 'error.forbidden');
      return;
    }

    try {
      const info = await readGgufInfo(path);
      sendJson(res, 200, { info });
    } catch (error) {
      sendJson(res, 500, { error: 'error.gguf', message: (error as Error).message });
    }
  };
}

interface RevealBody {
  path?: string;
}

export function revealModelRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: RevealBody;
    try {
      body = await readJson<RevealBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    if (!body.path || !isAbsolute(body.path)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    let info;
    try {
      info = await stat(body.path);
    } catch {
      sendError(res, 404, 'error.not_found');
      return;
    }

    const directory = info.isDirectory() ? body.path : dirname(body.path);
    const allowed = await listModelDirectories(context.modelDirs);
    const permitted = allowed.some((base) => isWithin(directory, base));

    if (!permitted) {
      sendError(res, 403, 'error.forbidden');
      return;
    }

    try {
      await revealPath(directory);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: 'error.backend', message: (error as Error).message });
    }
  };
}
