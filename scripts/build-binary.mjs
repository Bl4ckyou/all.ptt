// Produces a single executable with Bun. Assets are inlined in the bundle.
// Requires Bun: https://bun.sh
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync(
  'bun',
  ['build', 'apps/server/src/index.ts', '--compile', '--outfile', 'dist/ptt'],
  { cwd: root, stdio: 'inherit' },
);

if (result.error) {
  console.error('bun is required for build:binary. See https://bun.sh');
  process.exit(1);
}
process.exit(result.status ?? 1);
