import type { AppContext } from './context.js';
import { Router } from './router.js';
import {
  backendSettingsRoute,
  backendsRoute,
  installBackendRoute,
  launchBackendRoute,
  stopBackendRoute,
  updateBackendsRoute,
} from './routes/backends.js';
import { chatRoute } from './routes/chat.js';
import { healthRoute } from './routes/health.js';
import { i18nCatalogRoute, i18nLocalesRoute } from './routes/i18n.js';
import { localModelsRoute, revealModelRoute } from './routes/local-models.js';
import { modelConfigRoute, saveModelConfigRoute } from './routes/model-config.js';
import { modelsRoute } from './routes/models.js';
import { providersRoute } from './routes/providers.js';

export function createApp(context: AppContext): Router {
  return new Router()
    .get('/api/health', healthRoute)
    .get('/api/providers', providersRoute(context.registry))
    .get('/api/models', modelsRoute(context.registry))
    .get('/api/models/local', localModelsRoute(context))
    .post('/api/models/reveal', revealModelRoute(context))
    .post('/api/chat', chatRoute(context.registry))
    .get('/api/i18n', i18nLocalesRoute)
    .get('/api/i18n/:locale', i18nCatalogRoute)
    .get('/api/backends', backendsRoute(context))
    .get('/api/backends/settings', backendSettingsRoute(context))
    .post('/api/backends/install', installBackendRoute(context))
    .post('/api/backends/update', updateBackendsRoute(context))
    .post('/api/backends/launch', launchBackendRoute(context))
    .post('/api/backends/stop', stopBackendRoute(context))
    .get('/api/models/config', modelConfigRoute(context))
    .post('/api/models/config', saveModelConfigRoute(context));
}
