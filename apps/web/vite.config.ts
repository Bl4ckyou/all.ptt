import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const apiPort = process.env.PTT_PORT ?? '4750';
const webPort = Number(process.env.PTT_WEB_PORT ?? 5173);

export default defineConfig({
  root: here('./'),
  build: {
    outDir: here('../../dist/web'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: webPort,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
