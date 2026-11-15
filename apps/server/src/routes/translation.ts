import type { AppContext } from '../context.js';
import { readJson, sendError, sendJson } from '../http.js';
import type { Handler } from '../router.js';

export function translationStatusRoute(context: AppContext): Handler {
  return ({ res }) => {
    sendJson(res, 200, context.translationManager.status());
  };
}

export function translationDownloadRoute(context: AppContext): Handler {
  return ({ res }) => {
    sendJson(res, 202, context.translationManager.startDownload());
  };
}

interface EnableBody {
  path?: string;
}

export function translationEnableRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: EnableBody;
    try {
      body = await readJson<EnableBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    if (!body.path) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const status = await context.translationManager.enableWithModel(body.path);
    sendJson(res, status.status === 'ready' ? 200 : 400, status);
  };
}

export function translationDisableRoute(context: AppContext): Handler {
  return async ({ res }) => {
    await context.translationManager.disable();
    sendJson(res, 200, context.translationManager.status());
  };
}
