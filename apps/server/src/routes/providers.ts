import { sendJson } from '../http.js';
import type { ProviderRegistry } from '../providers.js';
import type { Handler } from '../router.js';

export function providersRoute(registry: ProviderRegistry): Handler {
  return ({ res }) => {
    const providers = registry.all().map((provider) => ({
      id: provider.id,
      capabilities: provider.capabilities(),
    }));
    sendJson(res, 200, { providers });
  };
}
