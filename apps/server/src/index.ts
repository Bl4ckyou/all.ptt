import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { webAssets } from './generated/assets.js';
import { ProviderRegistry } from './providers.js';
import { serveStatic } from './static.js';

const config = await loadConfig();
const registry = new ProviderRegistry(config.providers);
const app = createApp(registry);

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

server.listen(config.port, config.host, () => {
  console.log(`PTT listening on http://${config.host}:${config.port}`);
  const webCount = Object.keys(webAssets).length;
  if (webCount === 0) {
    console.log('  web UI: not built — run `npm run build`, or `npm run dev` and open http://127.0.0.1:5173');
  } else {
    console.log(`  web UI: ${webCount} assets`);
  }
  console.log(`  config: ${process.env.PTT_CONFIG ?? 'config.json'} (optional)`);
  for (const provider of registry.all()) {
    console.log(`  provider: ${provider.id}`);
  }
});
