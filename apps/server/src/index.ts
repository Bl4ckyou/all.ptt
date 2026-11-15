import { createServer } from 'node:http';
import { BackendLauncher, loadManifest, scanLocalFiles } from '@ptt/backends';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { readCustomBackends } from './custom-backends.js';
import { webAssets } from './generated/assets.js';
import { JobManager } from './jobs.js';
import { ProviderRegistry } from './providers.js';
import { ProjectStore } from './projects.js';
import { serveStatic } from './static.js';
import { MutableTranslator, ProviderTranslator, TranslationService } from './translation.js';
import { TranslationManager } from './translation-backend.js';

const config = await loadConfig().catch((error: Error) => {
  console.error(`Failed to load config: ${error.message}`);
  process.exit(1);
});
const registry = new ProviderRegistry(config.providers);
const launcher = new BackendLauncher(config.backendRoot, (providerId) => registry.remove(providerId));
const jobs = new JobManager();
const projects = new ProjectStore(config.backendRoot);
const translator = new MutableTranslator();
if (config.translation) {
  translator.inner = new ProviderTranslator(registry, config.translation);
}
const translation = new TranslationService(config.backendRoot, translator);
const translationManager = new TranslationManager(
  config.backendRoot,
  registry,
  launcher,
  translator,
  config.modelDirs,
);
const manifest = loadManifest();
const custom = await readCustomBackends(config.backendRoot);
for (const [id, backend] of Object.entries(custom.backends)) {
  manifest.backends[id] = backend;
}
void scanLocalFiles(config.modelDirs).catch(() => undefined);

const context = {
  registry,
  launcher,
  jobs,
  projects,
  manifest,
  root: config.backendRoot,
  modelDirs: config.modelDirs,
  translation,
  translationManager,
};
const app = createApp(context);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    launcher.stopAll();
    process.exit(0);
  });
}

const server = createServer(async (req, res) => {
  try {
    if (await app.handle(req, res)) return;

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/') && serveStatic(res, url.pathname)) return;

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (error) {
    console.error(error);
    if (res.headersSent) {
      res.end();
    } else {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'error.unknown' }));
    }
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use on ${config.host}.`);
    console.error('Stop the process using it, or set PTT_PORT to another port.');
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`all.ptt listening on http://${config.host}:${config.port}`);
  const webCount = Object.keys(webAssets).length;
  if (webCount === 0) {
    console.log('  web UI: not built — run `npm run build`, or `npm run dev` and open http://127.0.0.1:5173');
  } else {
    console.log(`  web UI: ${webCount} assets`);
  }
  console.log(`  config: ${process.env.PTT_CONFIG ?? 'config.json'} (optional)`);
  console.log(`  backends: ${config.backendRoot}/.backends`);
  for (const provider of registry.all()) {
    console.log(`  provider: ${provider.id}`);
  }
});
