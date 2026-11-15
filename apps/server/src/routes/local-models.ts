import { dirname, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { listModelDirectories, revealPath, scanLocalFiles } from '@ptt/backends';
import type { AppContext } from '../context.js';
import { readJson, sendError, sendJson } from '../http.js';
import type { Handler } from '../router.js';
import { isWithin } from '../validation.js';

export function localModelsRoute(context: AppContext): Handler {
  return async ({ res }) => {
    const [files, directories] = await Promise.all([
      scanLocalFiles(context.modelDirs),
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
