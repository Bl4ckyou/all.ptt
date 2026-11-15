import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BackendLauncher,
  clearModelScanCache,
  huggingFaceHubDir,
  readJsonFile,
  writeJsonFile,
  quantizationOf,
  readGgufSignature,
  readInstalledStates,
  resolveInstalledBinary,
  scanLocalFiles,
  type RunningBackend,
} from '@ptt/backends';
import { isTranslationModel, languageName, type ChatMessage } from '@ptt/core';
import { OpenAICompatibleProvider } from '@ptt/providers';
import type { ProviderRegistry } from './providers.js';
import type { MutableTranslator, Translator } from './translation.js';
import {
  clampSpeed,
  concurrencyFor,
  normalSpeed,
  speedConfig,
  totalContext,
  type SpeedOption,
  type TranslationSpeed,
} from './translation-speed.js';

const PROVIDER_ID = 'ptt-translation';
const MODEL_ALIAS = 'ptt-translation';
const PLAMO_REPO = 'pfnet/plamo-3-translate-0.8b-GGUF';
const PLAMO_FILE = 'plamo-3-translate-0.8b-Q4_K_M.gguf';
const PLAMO_URL = `https://huggingface.co/${PLAMO_REPO}/resolve/main/${PLAMO_FILE}`;

const GLOSSARY: Record<string, [string, string][]> = {
  fr: [
    ['thread', 'thread'],
    ['polling', 'polling'],
    ['draft', 'brouillon'],
    ['prompt', 'prompt'],
    ['offload', 'décharger'],
    ['cache', 'cache'],
    ['batch', 'lot'],
    ['token', 'jeton'],
    ['layer', 'couche'],
    ['weight', 'poids'],
    ['sampling', 'échantillonnage'],
    ['context', 'contexte'],
  ],
  es: [
    ['thread', 'hilo'],
    ['polling', 'sondeo'],
    ['draft', 'borrador'],
    ['prompt', 'prompt'],
    ['offload', 'descargar'],
    ['cache', 'caché'],
    ['batch', 'lote'],
    ['token', 'token'],
    ['layer', 'capa'],
    ['weight', 'peso'],
    ['sampling', 'muestreo'],
    ['context', 'contexto'],
  ],
  de: [
    ['thread', 'Thread'],
    ['polling', 'Polling'],
    ['draft', 'Entwurf'],
    ['prompt', 'Prompt'],
    ['offload', 'auslagern'],
    ['cache', 'Cache'],
    ['batch', 'Batch'],
    ['token', 'Token'],
    ['layer', 'Ebene'],
    ['weight', 'Gewicht'],
    ['sampling', 'Sampling'],
    ['context', 'Kontext'],
  ],
  ja: [
    ['thread', 'スレッド'],
    ['polling', 'ポーリング'],
    ['draft', 'ドラフト'],
    ['prompt', 'プロンプト'],
    ['offload', 'オフロード'],
    ['cache', 'キャッシュ'],
    ['batch', 'バッチ'],
    ['token', 'トークン'],
    ['layer', 'レイヤー'],
    ['weight', '重み'],
    ['sampling', 'サンプリング'],
    ['context', 'コンテキスト'],
  ],
};

function glossaryFor(locale: string): { source: string; target: string }[] | undefined {
  const entries = GLOSSARY[locale.split(/[-_]/)[0]];
  return entries?.map(([source, target]) => ({ source, target }));
}

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
  translating?: { done: number; total: number };
  speed?: TranslationSpeed;
  speeds?: SpeedOption[];
  memoryGb?: number;
  maxConcurrency?: number;
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
  const matched = all.filter((file) => isTranslationModel(file.tags, file.chatTemplate));

  const rank = (file: (typeof all)[number]): number => {
    let score = /target_lang/.test(file.chatTemplate ?? '') ? -6 : 0;
    if (file.path.toLowerCase().includes('q4_k_m')) score -= 2;
    return score;
  };
  matched.sort((a, b) => rank(a) - rank(b));

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

export function splitForTranslation(text: string, limit = 1200): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('. ', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

class NativeTranslator implements Translator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly template: boolean,
    private readonly onProgress?: (done: number, total: number) => void,
    private readonly concurrency: () => number = () => 2,
  ) {}

  async translate(texts: string[], locale: string): Promise<string[]> {
    const provider = this.registry.get(PROVIDER_ID);
    if (!provider) throw new Error('translation provider is not running');

    let done = 0;
    return mapLimit(texts, this.concurrency(), async (text) => {
      const pieces: string[] = [];

      try {
        for (const chunk of splitForTranslation(text)) {
          let content = '';
          for await (const event of provider.chat({
            model: MODEL_ALIAS,
            messages: [{ role: 'user', content: chunk }],
            temperature: 0,
            maxTokens: 768,
            signal: AbortSignal.timeout(45_000),
            ...(this.template
              ? {
                  chatTemplateKwargs: {
                    source_lang: 'en',
                    target_lang: targetLang(locale),
                    context: 'Technical command-line settings for a local LLM inference server.',
                    ...(glossaryFor(locale) ? { glossary: glossaryFor(locale) } : {}),
                  },
                }
              : {}),
          })) {
            if (event.type === 'content') content += event.delta;
          }
          if (!content.trim()) return '';
          pieces.push(content.trim());
        }
      } catch {
        // A slow or stuck translation must not block the whole batch.
        return '';
      }

      done += 1;
      this.onProgress?.(done, texts.length);
      return pieces.join(' ');
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

class PromptTranslator implements Translator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly onProgress?: (done: number, total: number) => void,
    private readonly concurrency: () => number = () => 2,
  ) {}

  async translate(texts: string[], locale: string): Promise<string[]> {
    const provider = this.registry.get(PROVIDER_ID);
    if (!provider) throw new Error('translation provider is not running');

    const language = languageName(locale);
    const code = targetLang(locale);
    const system =
      `You are a professional translator. Translate the user's text into ${language} (${code}). ` +
      'Preserve placeholders like \uE0000\uE001, command-line flags and code spans exactly. ' +
      'Output only the translation.';

    let done = 0;
    return mapLimit(texts, this.concurrency(), async (text) => {
      const pieces: string[] = [];
      try {
        for (const chunk of splitForTranslation(text)) {
          let content = '';
          for await (const event of provider.chat({
            model: MODEL_ALIAS,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: chunk },
            ],
            temperature: 0,
            maxTokens: 768,
            signal: AbortSignal.timeout(45_000),
          })) {
            if (event.type === 'content') content += event.delta;
          }
          if (!content.trim()) return '';
          pieces.push(content.trim());
        }
      } catch {
        return '';
      }
      done += 1;
      this.onProgress?.(done, texts.length);
      return pieces.join(' ');
    });
  }
}

class ManagedTranslator implements Translator {
  constructor(private readonly manager: TranslationManager) {}

  isReady(): boolean {
    return true;
  }

  translate(texts: string[], locale: string): Promise<string[]> {
    return this.manager.translateInternal(texts, locale);
  }
}

export class TranslationManager {
  private state: TranslationStatus = { status: 'idle', progress: 0, total: 0 };
  private running: RunningBackend | null = null;
  private candidates: TranslationCandidate[] = [];
  private active: Translator | null = null;
  private modelPath: string | null = null;
  private modelTemplate = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;
  private readonly speedConfig = speedConfig(totalmem());
  private speed: TranslationSpeed = normalSpeed(this.speedConfig);
  private readonly settingsPath: string;

  constructor(
    private readonly root: string,
    private readonly registry: ProviderRegistry,
    private readonly launcher: BackendLauncher,
    private readonly translator: MutableTranslator,
    private readonly modelDirs: string[] = [],
  ) {
    this.settingsPath = join(root, '.ptt', 'translation.json');
    if (translator.inner) {
      this.state = { status: 'ready', progress: 0, total: 0, providerId: PROVIDER_ID };
    }
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<{ speed?: TranslationSpeed }>(this.settingsPath);
    this.speed = clampSpeed(this.speedConfig, stored?.speed ?? this.speed);
  }

  concurrency(): number {
    return concurrencyFor(this.speedConfig, this.speed);
  }

  async setSpeed(speed: TranslationSpeed): Promise<TranslationStatus> {
    this.speed = clampSpeed(this.speedConfig, speed);
    await writeJsonFile(this.settingsPath, { speed: this.speed });
    return this.status();
  }

  status(): TranslationStatus {
    return {
      ...this.state,
      candidates: this.candidates,
      speed: this.speed,
      speeds: this.speedConfig.options,
      memoryGb: this.speedConfig.memoryGb,
      maxConcurrency: this.speedConfig.maxConcurrency,
    };
  }

  async refreshCandidates(): Promise<void> {
    try {
      this.candidates = await findTranslationCandidates(this.modelDirs);
    } catch {
      this.candidates = [];
    }
  }

  async translateInternal(texts: string[], locale: string): Promise<string[]> {
    await this.ensureBackend();
    if (!this.active) throw new Error('translation backend is not available');
    this.state = { ...this.state, translating: { done: 0, total: texts.length } };
    try {
      return await this.active.translate(texts, locale);
    } finally {
      this.state = { ...this.state, translating: undefined };
      this.scheduleIdleStop();
    }
  }

  private updateProgress(done: number, total: number): void {
    if (this.state.translating) this.state = { ...this.state, translating: { done, total } };
  }

  private scheduleIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stopBackend(), 90_000);
    this.idleTimer.unref?.();
  }

  private stopBackend(): void {
    if (this.running) this.launcher.stop(this.running.providerId);
    this.running = null;
    this.active = null;
    this.registry.remove(PROVIDER_ID);
  }

  private async ensureBackend(): Promise<void> {
    if (this.running && this.active) return;
    if (this.starting) return this.starting;
    if (!this.modelPath) throw new Error('no translation model selected');

    const path = this.modelPath;
    const template = this.modelTemplate;
    this.starting = this.startBackend(path, template).finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async startBackend(path: string, template: boolean): Promise<void> {
    const binary = await this.findLlamaBinary();
    if (!binary) throw new Error('no llama.cpp backend is installed');

    if (this.running) this.launcher.stop(this.running.providerId);
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
          '--parallel',
          String(this.speedConfig.maxConcurrency),
          '--ctx-size',
          String(totalContext(this.speedConfig)),
        ],
      },
    });

    this.registry.add(
      new OpenAICompatibleProvider({
        id: PROVIDER_ID,
        baseUrl: `http://127.0.0.1:${this.running.port}/v1`,
      }),
    );

    this.active = template
      ? new NativeTranslator(
          this.registry,
          true,
          (done, total) => this.updateProgress(done, total),
          () => this.concurrency(),
        )
      : new PromptTranslator(
          this.registry,
          (done, total) => this.updateProgress(done, total),
          () => this.concurrency(),
        );
  }

  async disable(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.stopBackend();
    this.modelPath = null;
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
      clearModelScanCache();
      await this.refreshCandidates();
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

      const template = /target_lang/.test(signature.chatTemplate ?? '');
      this.modelPath = path;
      this.modelTemplate = template;
      await this.startBackend(path, template);
      this.translator.inner = new ManagedTranslator(this);

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
      this.scheduleIdleStop();
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
