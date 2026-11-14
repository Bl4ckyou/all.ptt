import { spawn } from 'node:child_process';

const shell = process.platform === 'win32';
const children = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell }),
];

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

let remaining = children.length;
for (const child of children) {
  child.on('exit', () => {
    if (--remaining === 0) process.exit(0);
  });
}
