import { isAbsolute } from 'node:path';
import {
  readModelConfig,
  writeModelConfig,
  type SettingValue,
} from '@ptt/backends';
import type { AppContext } from '../context.js';
import { sendError, sendJson, readJsonOrError } from '../http.js';
import type { Handler } from '../router.js';

export function modelConfigRoute(context: AppContext): Handler {
  return async ({ url, res }) => {
    const path = url.searchParams.get('path');
    if (!path || !isAbsolute(path)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const config = await readModelConfig(context.root, path);
    sendJson(res, 200, { config });
  };
}

interface SaveConfigBody {
  path?: string;
  settings?: Record<string, SettingValue>;
  extraArgs?: string;
}

function sanitizeSettings(input: Record<string, SettingValue>): Record<string, SettingValue> {
  const settings: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      settings[key] = value;
    }
  }
  return settings;
}

export function saveModelConfigRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    const body = await readJsonOrError<SaveConfigBody>(req, res);
    if (!body) return;

    if (!body.path || !isAbsolute(body.path) || !body.settings) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const config = await writeModelConfig(context.root, body.path, {
      settings: sanitizeSettings(body.settings),
      extraArgs: body.extraArgs ?? '',
    });
    sendJson(res, 200, { config });
  };
}
