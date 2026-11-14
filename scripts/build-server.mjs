import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await mkdir(`${root}dist`, { recursive: true });

await build({
  entryPoints: [`${root}apps/server/src/index.ts`],
  outfile: `${root}dist/server.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

console.log('server bundle ready: dist/server.js');
