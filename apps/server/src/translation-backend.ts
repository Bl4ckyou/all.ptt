import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BackendLauncher,
  huggingFaceHubDir,
  quantizationOf,
  readGgufSignature,
  readInstalledStates,
  resolveInstalledBinary,
  scanLocalFiles,
  type RunningBackend,
} from '@ptt/backends';
import type { ChatMessage } from '@ptt/core';
import { OpenAICompatibleProvider } from '@ptt/providers';
import type { ProviderRegistry } from './providers.js';
import { ProviderTranslator, type MutableTranslator, type Translator } from './translation.js';

const PROVIDER_ID = 'ptt-translation';
const MODEL_ALIAS = 'ptt-translation';
const PLAMO_REPO = 'pfnet/plamo-3-translate-0.8b-GGUF';
const PLAMO_FILE = 'plamo-3-translate-0.8b-Q4_K_M.gguf';
const PLAMO_URL = `https://huggingface.co/${PLAMO_REPO}/resolve/main/${PLAMO_FILE}`;

const PLAMO_LANGUAGES = [
  'ja', 'en', 'zh-hans', 'zh-hant', 'ko', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'ceb', 'de',
  'es', 'et', 'eu', 'fa', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'jv', 'ka',
  'kk', 'km', 'lt', 'lv', 'ml', 'mr', 'ms', 'my', 'ne', 'nl', 'pa', 'pl', 'ru', 'si', 'sk',
  'sl', 'sr', 'sw', 'ta', 'te', 'th', 'tl', 'ur', 'uz', 'vi',
];

export interface TranslationCandidate {
  path: string;
  name: string;
  quant: string | null;
  contextLength: number | null;
  targetLang: boolean;
}

export interface TranslationStatus {
  status: 'idle' | 'downloading' | 'starting' | 'ready' | 'error';
  progress: number;
  total: number;
  error?: string;
  providerId?: string;
  model?: {
    path: string;
    name: string;
    quant: string | null;
    contextLength: number | null;
    targetLang: boolean;
  };
  languages?: string[];
  candidates?: TranslationCandidate[];
}

function targetLang(locale: string): string {
  const value = locale.toLowerCase();
  if (value.startsWith('zh')) {
    return value.includes('tw') || value.includes('hant') ? 'zh-hant' : 'zh-hans';
  }
  return value.split(/[-_]/)[0];
}

function publicModelPath(root: string): string {
  return join(root, '.ptt', 'translation', 'plamo-3-translate-0.8b-Q4_K_M.gguf');
}

export async function findTranslationCandidates(
  directories: string[],
): Promise<TranslationCandidate[]> {
  const files = await scanLocalFiles(directories);
  const all = [...files.models, ...files.drafts, ...files.auxiliary];
  const matched = all.filter((file) => /(translat|plamo)/i.test(file.path));

  const rank = (path: string): number => {
    const value = path.toLowerCase();
    let score = 0;
    if (value.includes('plamo')) score -= 4;
    if (value.includes('q4_k_m')) score -= 2;
    if (value.includes('translategemma')) score -= 1;
    return score;
  };
  matched.sort((a, b) => rank(a.path) - rank(b.path));

  return matched.slice(0, 8).map((file) => ({
    path: file.path,
    name: file.name,
    quant: file.quantization ?? null,
    contextLength: file.contextLength ?? null,
    targetLang: /target_lang/.test(file.chatTemplate ?? ''),
  }));
}

export async function findTranslationModel(directories: string[]): Promise<string | null> {
  const candidates = await findTranslationCandidates(directories);
  return candidates[0]?.path ?? null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

class NativeTranslator implements Translator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly template: boolean,
  ) {}

  async translate(texts: string[], locale: string): Promise<string[]> {
    const provider = this.registry.get(PROVIDER_ID);
    if (!provider) throw new Error('translation provider is not running');

    return mapLimit(texts, 4, async (text) => {
      const messages: ChatMessage[] = [{ role: 'user', content: text }];
      let content = '';
      for await (const event of provider.chat({
        model: MODEL_ALIAS,
        messages,
        temperature: 0,
        ...(this.template
          ? {
              chatTemplateKwargs: {
                source_lang: 'en',
                target_lang: targetLang(locale),
                context: 'Technical command-line settings for a local LLM inference server.',
              },
            }
          : {}),
      })) {
        if (event.type === 'content') content += event.delta;
      }
      return content.trim();
    });
  }
}

async function downloadToHuggingFaceCache(
  onProgress: (done: number, total: number) => void,
): Promise<string> {
  const head = await fetch(PLAMO_URL, { method: 'HEAD', redirect: 'follow' });
  if (!head.ok) throw new Error(`download failed: ${head.status}`);

  const total = Number(head.headers.get('content-length') ?? 0);
  const etag = (head.headers.get('x-linked-etag') ?? head.headers.get('etag') ?? '')
    .replace(/"/g, '')
    .trim();

  const model = await fetch(`https://huggingface.co/api/models/${PLAMO_REPO}`);
  if (!model.ok) throw new Error(`cannot resolve ${PLAMO_REPO}`);
  const revision = ((await model.json()) as { sha?: string }).sha ?? 'main';

  const repoDir = join(huggingFaceHubDir(), `models--${PLAMO_REPO.replace('/', '--')}`);
  const blobs = join(repoDir, 'blobs');
  const snapshot = join(repoDir, 'snapshots', revision);
  const blob = join(blobs, etag || PLAMO_FILE);
  const target = join(snapshot, PLAMO_FILE);

  await mkdir(blobs, { recursive: true });
  await mkdir(snapshot, { recursive: true });
  await mkdir(join(repoDir, 'refs'), { recursive: true });
  await writeFile(join(repoDir, 'refs', 'main'), revision);

  const existing = await stat(blob).catch(() => null);
  if (!existing || (total > 0 && existing.size !== total)) {
    const temporary = `${blob}.incomplete`;
    const response = await fetch(PLAMO_URL);
    if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);

    const output = createWriteStream(temporary);
    const reader = response.body.getReader();
    let done = 0;
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      const buffer = Buffer.from(value);
      if (!output.write(buffer)) {
        await new Promise<void>((resolve) => output.once('drain', resolve));
      }
      done += buffer.length;
      onProgress(done, total);
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    await rename(temporary, blob);
  }

  try {
    await symlink(join('..', '..', 'blobs', etag || PLAMO_FILE), target);
  } catch {
    await rm(target, { force: true });
    await copyFile(blob, target);
  }

  return target;
}

export class TranslationManager {
  private state: TranslationStatus = { status: 'idle', progress: 0, total: 0 };
  private running: RunningBackend | null = null;
  private candidates: TranslationCandidate[] = [];

  constructor(
    private readonly root: string,
    private readonly registry: ProviderRegistry,
    private readonly launcher: BackendLauncher,
    private readonly translator: MutableTranslator,
    private readonly modelDirs: string[] = [],
  ) {
    if (translator.inner) {
      this.state = { status: 'ready', progress: 0, total: 0, providerId: PROVIDER_ID };
    }
    void this.refreshCandidates();
  }

  status(): TranslationStatus {
    return { ...this.state, candidates: this.candidates };
  }

  private async refreshCandidates(): Promise<void> {
    try {
      this.candidates = await findTranslationCandidates(this.modelDirs);
    } catch {
      this.candidates = [];
    }
  }

  async disable(): Promise<void> {
    if (this.running) {
      this.launcher.stop(this.running.providerId);
      this.running = null;
    }
    this.registry.remove(PROVIDER_ID);
    this.translator.inner = null;
    this.state = { status: 'idle', progress: 0, total: 0 };
    await this.refreshCandidates();
  }

  startDownload(): TranslationStatus {
    if (this.state.status === 'downloading' || this.state.status === 'starting') {
      return this.status();
    }

    const destination = publicModelPath(this.root);
    this.state = { status: 'downloading', progress: 0, total: 0 };

    void (async () => {
      const existing = await stat(destination).catch(() => null);
      if (existing?.isFile() && existing.size > 1024) {
        await this.enableWithModel(destination);
        return;
      }

      const cached = await findTranslationModel(this.modelDirs);
      if (cached) {
        await this.enableWithModel(cached);
        return;
      }

      const modelPath = await downloadToHuggingFaceCache((done, total) => {
        this.state = { status: 'downloading', progress: done, total };
      });
      await this.enableWithModel(modelPath);
    })().catch((error: Error) => {
      this.state = { status: 'error', progress: 0, total: 0, error: error.message };
    });

    return this.status();
  }

  async enableWithModel(path: string): Promise<TranslationStatus> {
    this.state = { status: 'starting', progress: 0, total: 0 };

    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('translation model must be a GGUF file');

      const signature = await readGgufSignature(path);
      if (!signature.hasTokenizer) throw new Error('not a usable GGUF model');

      const binary = await this.findLlamaBinary();
      if (!binary) throw new Error('no llama.cpp backend is installed');

      if (this.running) {
        this.launcher.stop(this.running.providerId);
        this.running = null;
      }

      this.running = await this.launcher.launch({
        binary,
        backendId: 'translation',
        modelPath: path,
        local: {
          binary: '',
          baseArgs: [
            '-m',
            '{model}',
            '--host',
            '{host}',
            '--port',
            '{port}',
            '--jinja',
            '--alias',
            MODEL_ALIAS,
          ],
        },
      });

      this.registry.add(
        new OpenAICompatibleProvider({
          id: PROVIDER_ID,
          baseUrl: `http://127.0.0.1:${this.running.port}/v1`,
        }),
      );

      const template = /target_lang/.test(signature.chatTemplate ?? '');
      this.translator.inner = template
        ? new NativeTranslator(this.registry, true)
        : new ProviderTranslator(this.registry, { providerId: PROVIDER_ID, model: MODEL_ALIAS });

      const name = signature.name ?? signature.basename ?? 'translation model';
      this.state = {
        status: 'ready',
        progress: 0,
        total: 0,
        providerId: PROVIDER_ID,
        model: {
          path,
          name,
          quant: quantizationOf(path, signature),
          contextLength: signature.contextLength,
          targetLang: template,
        },
        languages:
          template && /plamo/i.test(`${signature.name ?? ''} ${signature.architecture ?? ''}`)
            ? PLAMO_LANGUAGES
            : undefined,
      };
      return this.status();
    } catch (error) {
      this.state = {
        status: 'error',
        progress: 0,
        total: 0,
        error: (error as Error).message,
      };
      return this.status();
    }
  }

  private async findLlamaBinary(): Promise<string | null> {
    for (const id of ['llama-cpp', 'ik-llama-cpp']) {
      const resolved = await resolveInstalledBinary(this.root, id);
      if (resolved) return resolved.record.binary;
    }

    const states = await readInstalledStates(this.root);
    for (const state of Object.values(states)) {
      for (const variant of Object.values(state.variants)) {
        if (/llama-server(\.exe)?$/i.test(variant.binary)) return variant.binary;
      }
    }
    return null;
  }
}
