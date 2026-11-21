import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function playwrightChromeCandidates(): string[] {
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
  ].filter((base): base is string => Boolean(base));
  const candidates = [];
  for (const base of [...new Set(bases)]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      if (entry.startsWith('chromium-')) {
        candidates.push(
          join(base, entry, 'chrome-linux64', 'chrome'),
          join(base, entry, 'chrome-linux', 'chrome'),
          join(base, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          join(base, entry, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          join(base, entry, 'chrome-win', 'chrome.exe'),
          join(base, entry, 'chrome-win64', 'chrome.exe'),
        );
      }
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(
          join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          join(base, entry, 'chrome-headless-shell-mac', 'chrome-headless-shell'),
          join(base, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          join(base, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        );
      }
    }
  }
  return candidates;
}

function commonChromeCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
  }
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    return [
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
  }
  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
}

export function findChrome(): string {
  const candidates = [process.env.PTT_CHROME, ...playwrightChromeCandidates(), ...commonChromeCandidates()];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) {
    throw new Error(
      'Chromium introuvable. Installe Chrome/Chromium ou définis PTT_CHROME=/chemin/vers/chrome.',
    );
  }
  return chrome;
}

interface CdpError {
  message: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: CdpError;
  sessionId?: string;
}

type CdpListener = (params: unknown, sessionId?: string) => void;

class CdpPipe {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly listeners = new Map<string, Array<{ listener: CdpListener; sessionId?: string }>>();
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly read: Readable,
    private readonly write: Writable,
    child: ChildProcess,
  ) {
    read.on('data', (chunk: Buffer) => this.onData(chunk));
    read.on('error', (error) => this.failAll(error));
    write.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => this.failAll(new Error(`Chromium exited with code ${code}`)));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let index = this.buffer.indexOf(0);
    while (index !== -1) {
      const raw = this.buffer.subarray(0, index).toString('utf8');
      this.buffer = this.buffer.subarray(index + 1);
      if (raw.length > 0) this.handle(JSON.parse(raw) as CdpMessage);
      index = this.buffer.indexOf(0);
    }
  }

  private handle(message: CdpMessage): void {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (!message.method) return;
    for (const entry of this.listeners.get(message.method) ?? []) {
      if (entry.sessionId && entry.sessionId !== message.sessionId) continue;
      entry.listener(message.params, message.sessionId);
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeout = 30_000,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Chromium connection is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.write.write(
        Buffer.from(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
        ),
      );
    });
  }

  on(method: string, listener: CdpListener, sessionId?: string): void {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push({ listener, sessionId });
    this.listeners.set(method, listeners);
  }

  close(): void {
    this.closed = true;
    this.write.end();
  }
}

interface EvaluateResult<T> {
  result: { value: T };
  exceptionDetails?: {
    text: string;
    exception?: { description?: string };
  };
}

export class BrowserPage {
  readonly errors: string[] = [];

  constructor(
    private readonly cdp: CdpPipe,
    private readonly targetId: string,
    private readonly sessionId: string,
  ) {}

  static async create(cdp: CdpPipe): Promise<BrowserPage> {
    const target = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const page = new BrowserPage(cdp, target.targetId, attached.sessionId);
    await page.init();
    return page;
  }

  private async init(): Promise<void> {
    this.cdp.on(
      'Runtime.exceptionThrown',
      (params) => {
        const details = params as {
          exceptionDetails: { text: string; exception?: { description?: string } };
        };
        this.errors.push(details.exceptionDetails.exception?.description ?? details.exceptionDetails.text);
      },
      this.sessionId,
    );
    this.cdp.on(
      'Runtime.consoleAPICalled',
      (params) => {
        const entry = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
        if (entry.type !== 'error') return;
        this.errors.push(entry.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
      },
      this.sessionId,
    );
    await this.cdp.send('Page.enable', {}, this.sessionId);
    await this.cdp.send('Runtime.enable', {}, this.sessionId);
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      this.sessionId,
    );
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.cdp.send<EvaluateResult<T>>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      this.sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(
    expression: string,
    { timeout = 8_000, message }: { timeout?: number; message?: string } = {},
  ): Promise<void> {
    const start = Date.now();
    let lastError: Error | undefined;
    while (Date.now() - start < timeout) {
      try {
        if (await this.evaluate(expression)) return;
      } catch (error) {
        lastError = error as Error;
      }
      await delay(50);
    }
    throw new Error(
      `${message ?? `Timed out waiting for ${expression}`}${lastError ? `: ${lastError.message}` : ''}`,
    );
  }

  async navigate(url: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await this.waitFor('document.readyState === "complete"');
  }

  async reload(): Promise<void> {
    await this.cdp.send('Page.reload', {}, this.sessionId);
    await this.waitFor('document.readyState === "complete"');
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Missing element: ${selector}`)});
      node.click();
    })()`);
  }

  async clickText(text: string, selector = 'button'): Promise<void> {
    await this.evaluate(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => (candidate.textContent ?? '').trim().includes(${JSON.stringify(text)}));
      if (!node) throw new Error(${JSON.stringify(`Missing ${selector} containing: ${text}`)});
      node.click();
    })()`);
  }

  async setValue(selector: string, value: string): Promise<void> {
    await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Missing element: ${selector}`)});
      const prototype = node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    })()`);
  }

  async focus(selector: string): Promise<void> {
    await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Missing element: ${selector}`)});
      node.focus();
    })()`);
  }

  async dispatchKey(selector: string | null, key: string): Promise<void> {
    await this.evaluate(`(() => {
      const node = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document'};
      if (!node) throw new Error(${JSON.stringify(`Missing element: ${selector ?? 'document'}`)});
      node.dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(key)},
        bubbles: true,
        cancelable: true,
      }));
    })()`);
  }

  async text(selector: string): Promise<string | null> {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
  }

  async count(selector: string): Promise<number> {
    return this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  async attribute(selector: string, name: string): Promise<string | null> {
    return this.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`,
    );
  }

  async isDisabled(selector: string): Promise<boolean> {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === true`);
  }

  async close(): Promise<void> {
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

export interface Browser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
}

export async function launchBrowser(): Promise<Browser> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ptt-chrome-'));
  const child = spawn(
    findChrome(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--mute-audio',
      '--remote-debugging-pipe',
      `--user-data-dir=${userDataDir}`,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });

  const command = child.stdio[3];
  const response = child.stdio[4];
  if (!command || !response) {
    await killProcessTree(child);
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    throw new Error('Chromium did not open its CDP pipe');
  }

  const cdp = new CdpPipe(response as Readable, command as Writable, child);
  const close = async (): Promise<void> => {
    cdp.close();
    await killProcessTree(child);
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  };

  try {
    return {
      newPage: () => BrowserPage.create(cdp),
      close,
    };
  } catch (error) {
    await close();
    throw new Error(
      `Chromium CDP connection failed: ${(error as Error).message}${stderr ? `\n${stderr}` : ''}`,
    );
  }
}

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntil(check: () => Promise<boolean>, timeout: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export interface AppHandle {
  appUrl: string;
  apiUrl: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function ensureApp({
  appUrl,
  apiUrl,
  root = repoRoot,
}: {
  appUrl: string;
  apiUrl: string;
  root?: string;
}): Promise<AppHandle> {
  const webUp = await isReachable(appUrl);
  const apiUp = await isReachable(apiUrl);
  if (webUp && apiUp) return { appUrl, apiUrl, stop: async () => {} };

  const appPort = process.env.PTT_URL ? Number(new URL(appUrl).port) : await freePort();
  const apiPort = process.env.PTT_API_URL ? Number(new URL(apiUrl).port) : await freePort();
  const actualApp = new URL(appUrl);
  actualApp.port = String(appPort);
  const actualApi = new URL(apiUrl);
  actualApi.port = String(apiPort);

  const child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PTT_PORT: String(apiPort),
      PTT_WEB_PORT: String(appPort),
    },
  });
  const stop = async (): Promise<void> => {
    await killProcessTree(child);
  };

  try {
    await waitUntil(
      async () => (await isReachable(actualApp.origin)) && (await isReachable(actualApi.toString())),
      60_000,
      'the dev server',
    );
    return { appUrl: actualApp.origin, apiUrl: actualApi.toString(), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
