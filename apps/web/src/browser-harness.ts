import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function playwrightChromeCandidates(): string[] {
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((entry) => entry.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((entry) => join(base, entry, 'chrome-linux64', 'chrome'));
}

export function findChrome(): string {
  const candidates = [
    process.env.PTT_CHROME,
    ...playwrightChromeCandidates(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) {
    throw new Error('Chromium introuvable. Définis PTT_CHROME ou installe Chromium.');
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
}

type CdpListener = (params: unknown) => void;

class Cdp {
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10_000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`CDP connection failed: ${url}`));
        },
        { once: true },
      );
    });
    return new Cdp(socket);
  }

  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, CdpListener[]>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (!message.method) return;
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params);
      }
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: CdpListener): void {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close(): void {
    this.socket.close();
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
  private cdp!: Cdp;
  private httpBase = '';

  static async create(httpBase: string): Promise<BrowserPage> {
    const response = await fetch(`${httpBase}/json/new?about:blank`, { method: 'PUT' });
    if (!response.ok) throw new Error(`Could not create a browser target: ${response.status}`);
    const target = (await response.json()) as { id: string; webSocketDebuggerUrl: string };
    const page = new BrowserPage();
    page.cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    page.httpBase = httpBase;
    page.targetId = target.id;
    await page.init();
    return page;
  }

  targetId = '';

  private async init(): Promise<void> {
    this.cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params as {
        exceptionDetails: { text: string; exception?: { description?: string } };
      };
      this.errors.push(details.exceptionDetails.exception?.description ?? details.exceptionDetails.text);
    });
    this.cdp.on('Runtime.consoleAPICalled', (params) => {
      const entry = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
      if (entry.type !== 'error') return;
      this.errors.push(entry.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.cdp.send<EvaluateResult<T>>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(expression: string, { timeout = 8_000, message }: { timeout?: number; message?: string } = {}): Promise<void> {
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
    await this.cdp.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
  }

  async reload(): Promise<void> {
    await this.cdp.send('Page.reload');
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
    this.cdp.close();
    await fetch(`${this.httpBase}/json/close/${this.targetId}`).catch(() => {});
  }
}

function waitForDevToolsUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stderr) {
      reject(new Error('Chromium stderr is unavailable'));
      return;
    }
    const stderr = child.stderr;
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Chromium did not expose a DevTools endpoint'));
    }, 15_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) return;
      cleanup();
      stderr.on('data', () => {});
      resolve(match[1]);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Chromium exited early with code ${code}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      stderr.off('data', onData);
      child.off('exit', onExit);
    };
    stderr.on('data', onData);
    child.on('exit', onExit);
  });
}

export interface Browser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
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
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  try {
    const devtoolsUrl = await waitForDevToolsUrl(child);
    const httpBase = devtoolsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');
    return {
      newPage: () => BrowserPage.create(httpBase),
      async close() {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGTERM');
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
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
  stop(): Promise<void>;
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
  if (webUp && apiUp) return { stop: async () => {} };
  if (webUp || apiUp) {
    throw new Error('The web server and API must both be running, or both be stopped before the UI tests start.');
  }

  const child = spawn('npm', ['run', 'dev'], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  const stop = async (): Promise<void> => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  };

  try {
    await waitUntil(
      async () => (await isReachable(appUrl)) && (await isReachable(apiUrl)),
      60_000,
      'the dev server',
    );
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
