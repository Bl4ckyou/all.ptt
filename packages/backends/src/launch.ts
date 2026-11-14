import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolveInstalledBinary } from './state.js';

export interface RunningBackend {
  providerId: string;
  backendId: string;
  port: number;
  modelPath: string;
  startedAt: string;
  log: string[];
}

export interface LaunchOptions {
  backendId?: string;
  modelPath: string;
  port?: number;
}

interface ProcessEntry extends RunningBackend {
  child: ChildProcess;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(start = 8080, end = 8099): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port between ${start} and ${end}`);
}

async function waitForHealth(child: ChildProcess, port: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('backend exited before becoming ready');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('backend did not become ready in time');
}

export class BackendLauncher {
  private readonly processes = new Map<string, ProcessEntry>();

  constructor(
    private readonly root: string,
    private readonly onExit?: (providerId: string) => void,
  ) {}

  list(): RunningBackend[] {
    return [...this.processes.values()].map(({ child: _child, ...rest }) => rest);
  }

  async launch(options: LaunchOptions): Promise<RunningBackend> {
    const resolved = await resolveInstalledBinary(this.root, options.backendId);
    if (!resolved) throw new Error('no installed backend binary found');

    const port = options.port ?? (await findFreePort());
    const providerId = `local-${port}`;

    const child = spawn(
      resolved.record.binary,
      ['-m', options.modelPath, '--host', '127.0.0.1', '--port', String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const entry: ProcessEntry = {
      providerId,
      backendId: resolved.backendId,
      port,
      modelPath: options.modelPath,
      startedAt: new Date().toISOString(),
      log: [],
      child,
    };
    this.processes.set(providerId, entry);

    const append = (chunk: Buffer): void => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        entry.log.push(line.trim());
        if (entry.log.length > 200) entry.log.shift();
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    child.on('exit', () => {
      this.processes.delete(providerId);
      this.onExit?.(providerId);
    });

    try {
      await waitForHealth(child, port);
    } catch (error) {
      child.kill('SIGTERM');
      this.processes.delete(providerId);
      const tail = entry.log.slice(-5).join('\n');
      throw new Error(`${(error as Error).message}${tail ? `\n${tail}` : ''}`);
    }

    return {
      providerId,
      backendId: entry.backendId,
      port,
      modelPath: entry.modelPath,
      startedAt: entry.startedAt,
      log: entry.log,
    };
  }

  stop(providerId: string): boolean {
    const entry = this.processes.get(providerId);
    if (!entry) return false;

    entry.child.kill('SIGTERM');
    setTimeout(() => {
      if (entry.child.exitCode === null) entry.child.kill('SIGKILL');
    }, 5000).unref();

    this.processes.delete(providerId);
    return true;
  }

  stopAll(): void {
    for (const providerId of [...this.processes.keys()]) this.stop(providerId);
  }
}
