import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = `${root}dist/server.js`;
const shell = process.platform === 'win32';

if (!existsSync(entry)) {
  console.log('dist/server.js not found, building first...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

let server = null;

function launch() {
  server = spawn(process.execPath, [entry], { cwd: process.cwd(), stdio: 'inherit' });
  server.on('exit', (code) => {
    if (code === 75) {
      console.log('Restarting PTT...');
      setTimeout(launch, 300);
      return;
    }
    process.exit(code ?? 0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server?.kill(signal));
}

launch();
