import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from '@ptt/backends';
import { baseLanguage, languageName, protectTokens, restoreTokens } from '@ptt/core';
import type { ChatMessage } from '@ptt/core';
import type { ProviderRegistry } from './providers.js';

export interface Translator {
  translate(texts: string[], locale: string): Promise<string[]>;
}

export interface TranslationConfig {
  providerId: string;
  model: string;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function cacheKey(locale: string): string {
  return locale.toLowerCase().replace(/[^a-z0-9-]/g, '_');
}

function cachePath(root: string, locale: string): string {
  return join(root, '.ptt', 'translations', `${cacheKey(locale)}.json`);
}

function parseArray(content: string): string[] | null {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(content.slice(start, end + 1)) as unknown;
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null;
    return value;
  } catch {
    return null;
  }
}

export class ProviderTranslator implements Translator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: TranslationConfig,
  ) {}

  async translate(texts: string[], locale: string): Promise<string[]> {
    const provider = this.registry.get(this.config.providerId);
    if (!provider) throw new Error(`unknown translation provider: ${this.config.providerId}`);

    const result: string[] = [];
    for (const chunk of chunkTexts(texts)) {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            `You are a translation engine. Translate every item of the JSON array into ${languageName(locale)}. ` +
            'Keep placeholders like \uE0000\uE001 unchanged. Keep flags, code spans and model names unchanged. ' +
            'Reply with only a JSON array of strings, same length and order.',
        },
        { role: 'user', content: JSON.stringify(chunk) },
      ];

      let content = '';
      for await (const event of provider.chat({
        model: this.config.model,
        messages,
        temperature: 0,
      })) {
        if (event.type === 'content') content += event.delta;
      }

      const parsed = parseArray(content);
      if (!parsed || parsed.length !== chunk.length) {
        throw new Error('translation provider returned an invalid response');
      }
      result.push(...parsed);
    }
    return result;
  }
}

function chunkTexts(texts: string[], limit = 4000): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const text of texts) {
    if (current.length > 0 && size + text.length > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class TranslationService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly root: string,
    private readonly translator: Translator | null,
  ) {}

  async translate(texts: string[], locale: string): Promise<string[]> {
    if (!this.translator || texts.length === 0 || baseLanguage(locale) === 'en') return texts;
    return this.withLock(cacheKey(locale), () => this.run(texts, locale));
  }

  private async run(texts: string[], locale: string): Promise<string[]> {
    const file = cachePath(this.root, locale);
    const cache = (await readJsonFile<Record<string, string>>(file)) ?? {};
    const keys = texts.map(hash);

    const pending = new Map<string, { masked: string; tokens: string[] }>();
    texts.forEach((text, index) => {
      if (cache[keys[index]] === undefined && !pending.has(keys[index])) {
        pending.set(keys[index], protectTokens(text));
      }
    });

    if (pending.size > 0) {
      const entries = [...pending.entries()];
      try {
        const translated = await this.translator!.translate(
          entries.map(([, value]) => value.masked),
          locale,
        );
        entries.forEach(([key, value], index) => {
          const restored = restoreTokens(translated[index] ?? '', value.tokens);
          if (restored !== null) cache[key] = restored;
        });
        await writeJsonFile(file, cache);
      } catch {
        return texts;
      }
    }

    return texts.map((text, index) => cache[keys[index]] ?? text);
  }

  private async withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tracked = next.catch(() => undefined);
    this.locks.set(key, tracked);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === tracked) this.locks.delete(key);
    }
  }
}
