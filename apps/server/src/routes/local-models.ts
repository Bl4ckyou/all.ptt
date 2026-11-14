import { scanLocalModels } from '@ptt/backends';
import type { AppContext } from '../context.js';
import { sendJson } from '../http.js';
import type { Handler } from '../router.js';

export function localModelsRoute(context: AppContext): Handler {
  return async ({ res }) => {
    const models = await scanLocalModels(context.modelDirs);
    sendJson(res, 200, { models });
  };
}
