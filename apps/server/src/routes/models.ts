import type { ModelInfo } from '@ptt/core';
import { sendJson } from '../http.js';
import type { ProviderRegistry } from '../providers.js';
import type { Handler } from '../router.js';

export function modelsRoute(registry: ProviderRegistry): Handler {
  return async ({ res }) => {
    const results = await Promise.allSettled(
      registry.all().map((provider) => provider.listModels()),
    );

    const models: ModelInfo[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') models.push(...result.value);
      else errors.push(String(result.reason));
    }

    sendJson(res, 200, { models, errors });
  };
}
