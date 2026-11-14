import type { ProviderRegistry } from './providers.js';
import { Router } from './router.js';
import { chatRoute } from './routes/chat.js';
import { healthRoute } from './routes/health.js';
import { i18nCatalogRoute, i18nLocalesRoute } from './routes/i18n.js';
import { modelsRoute } from './routes/models.js';
import { providersRoute } from './routes/providers.js';

export function createApp(registry: ProviderRegistry): Router {
  return new Router()
    .get('/api/health', healthRoute)
    .get('/api/providers', providersRoute(registry))
    .get('/api/models', modelsRoute(registry))
    .post('/api/chat', chatRoute(registry))
    .get('/api/i18n', i18nLocalesRoute)
    .get('/api/i18n/:locale', i18nCatalogRoute);
}
