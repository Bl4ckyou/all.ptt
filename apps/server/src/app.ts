import type { AppContext } from './context.js';
import { Router } from './router.js';
import {
  backendSettingsRoute,
  backendsRoute,
  cancelJobRoute,
  installBackendRoute,
  jobRoute,
  launchBackendRoute,
  pauseJobRoute,
  resumeJobRoute,
  stopBackendRoute,
  updateBackendsRoute,
} from './routes/backends.js';
import { chatRoute } from './routes/chat.js';
import { healthRoute } from './routes/health.js';
import { i18nCatalogRoute, i18nLocalesRoute } from './routes/i18n.js';
import {
  localModelsRoute,
  modelInfoRoute,
  revealModelRoute,
} from './routes/local-models.js';
import { modelConfigRoute, saveModelConfigRoute } from './routes/model-config.js';
import { modelsRoute } from './routes/models.js';
import {
  appendMessageRoute,
  conversationRoute,
  createConversationRoute,
  createProjectRoute,
  projectRoute,
  projectsRoute,
  saveNotesRoute,
} from './routes/projects.js';
import { providersRoute } from './routes/providers.js';
import {
  restartProjectRoute,
  systemInfoRoute,
  updateProjectRoute,
} from './routes/system.js';

export function createApp(context: AppContext): Router {
  return new Router()
    .get('/api/health', healthRoute)
    .get('/api/providers', providersRoute(context.registry))
    .get('/api/models', modelsRoute(context.registry))
    .get('/api/models/local', localModelsRoute(context))
    .get('/api/models/info', modelInfoRoute(context))
    .post('/api/models/reveal', revealModelRoute(context))
    .post('/api/chat', chatRoute(context.registry))
    .get('/api/i18n', i18nLocalesRoute)
    .get('/api/i18n/:locale', i18nCatalogRoute)
    .get('/api/backends', backendsRoute(context))
    .get('/api/backends/settings', backendSettingsRoute(context))
    .post('/api/backends/install', installBackendRoute(context))
    .post('/api/backends/update', updateBackendsRoute(context))
    .get('/api/backends/jobs/:id', jobRoute(context))
    .post('/api/backends/jobs/:id/pause', pauseJobRoute(context))
    .post('/api/backends/jobs/:id/resume', resumeJobRoute(context))
    .post('/api/backends/jobs/:id/cancel', cancelJobRoute(context))
    .post('/api/backends/launch', launchBackendRoute(context))
    .post('/api/backends/stop', stopBackendRoute(context))
    .get('/api/models/config', modelConfigRoute(context))
    .post('/api/models/config', saveModelConfigRoute(context))
    .get('/api/projects', projectsRoute(context))
    .post('/api/projects', createProjectRoute(context))
    .get('/api/projects/:id', projectRoute(context))
    .post('/api/projects/:id/notes', saveNotesRoute(context))
    .post('/api/projects/:id/conversations', createConversationRoute(context))
    .get('/api/projects/:id/conversations/:chatId', conversationRoute(context))
    .post('/api/projects/:id/conversations/:chatId/messages', appendMessageRoute(context))
    .get('/api/system/info', systemInfoRoute(context))
    .post('/api/system/update', updateProjectRoute(context))
    .post('/api/system/restart', restartProjectRoute(context));
}
