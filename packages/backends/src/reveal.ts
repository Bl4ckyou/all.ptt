import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';

function opener(): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: 'explorer', args: [] };
  if (process.platform === 'darwin') return { command: 'open', args: [] };
  return { command: 'xdg-open', args: [] };
}

// Open a file's folder (or the directory itself) in the OS file manager.
export async function revealPath(target: string): Promise<void> {
  const info = await stat(target);
  const directory = info.isDirectory() ? target : dirname(target);
  const { command, args } = opener();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, directory], { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}
