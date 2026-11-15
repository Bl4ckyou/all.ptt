import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { MutableTranslator, TranslationService, type Translator } from './translation.js';

class FakeTranslator implements Translator {
  readonly calls: string[][] = [];

  constructor(private readonly produce: (texts: string[]) => string[] = (texts) => texts.map((t) => `FR ${t}`)) {}

  async translate(texts: string[]): Promise<string[]> {
    this.calls.push(texts);
    return this.produce(texts);
  }
}

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-translate-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('TranslationService', () => {
  it('does not translate or cache before a translator is ready', async () => {
    const root = await workspace();
    const service = new TranslationService(root, new MutableTranslator());
    await expect(service.translate(['Hello'], 'fr')).resolves.toEqual(['Hello']);
    await expect(
      (await import('node:fs/promises')).readdir(join(root, '.ptt', 'translations')).catch(() => []),
    ).resolves.toEqual([]);
  });

  it('does not cache unchanged translations', async () => {
    const translator = new FakeTranslator((texts) => texts);
    const service = new TranslationService(await workspace(), translator);
    await service.translate(['Hello'], 'fr');
    await service.translate(['Hello'], 'fr');
    expect(translator.calls).toHaveLength(2);
  });

  it('does not translate english', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);
    await expect(service.translate(['Hello'], 'en')).resolves.toEqual(['Hello']);
    expect(translator.calls).toHaveLength(0);
  });

  it('translates and caches by source text', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);

    await expect(service.translate(['Hello'], 'fr')).resolves.toEqual(['FR Hello']);
    await expect(service.translate(['Hello'], 'fr')).resolves.toEqual(['FR Hello']);
    expect(translator.calls).toEqual([['Hello']]);
  });

  it('restores protected tokens after translation', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);

    await expect(service.translate(['Use --threads 8 with Q4_K_M'], 'fr')).resolves.toEqual([
      'FR Use --threads 8 with Q4_K_M',
    ]);
  });

  it('falls back to the source when the model drops a placeholder', async () => {
    const translator = new FakeTranslator(() => ['traduction sans placeholder']);
    const service = new TranslationService(await workspace(), translator);

    await expect(service.translate(['Use --threads 8'], 'fr')).resolves.toEqual(['Use --threads 8']);
  });

  it('falls back to the source when the translator fails', async () => {
    const translator = new FakeTranslator(() => {
      throw new Error('boom');
    });
    const service = new TranslationService(await workspace(), translator);

    await expect(service.translate(['Hello'], 'fr')).resolves.toEqual(['Hello']);
  });

  it('keeps locale variants in separate caches', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);

    await service.translate(['Hello'], 'zh-CN');
    await service.translate(['Hello'], 'zh-TW');
    expect(translator.calls).toHaveLength(2);
  });

  it('strips env suffixes before translating and restores them afterwards', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);
    await expect(
      service.translate(['CPU mask (env: LLAMA_ARG_X) (default: 0)'], 'fr'),
    ).resolves.toEqual(['FR CPU mask (default: 0) (env: LLAMA_ARG_X)']);
    expect(translator.calls[0]).toEqual(['CPU mask (default: 0)']);
  });

  it('reports translation coverage from the cache', async () => {
    const root = await workspace();
    const translator = new FakeTranslator();
    const service = new TranslationService(root, translator);

    await expect(service.coverage(['Hello', 'World'], 'fr')).resolves.toEqual({
      translated: 0,
      total: 2,
    });
    await service.translate(['Hello'], 'fr');
    await expect(service.coverage(['Hello', 'World'], 'fr')).resolves.toEqual({
      translated: 1,
      total: 2,
    });
  });

  it('ignores legacy cache versions for coverage', async () => {
    const root = await workspace();
    const translator = new FakeTranslator();
    const service = new TranslationService(root, translator);
    await service.translate(['Hello'], 'fr');

    await (await import('node:fs/promises')).mkdir(join(root, '.ptt', 'translations'), {
      recursive: true,
    });
    await writeFile(
      join(root, '.ptt', 'translations', 'fr.json'),
      JSON.stringify({ version: 3, entries: { anything: 'nope' } }),
    );

    await expect(service.coverage(['Hello'], 'fr')).resolves.toEqual({
      translated: 0,
      total: 1,
    });
  });

  it('does not cache empty translations', async () => {
    const translator = new FakeTranslator(() => ['']);
    const service = new TranslationService(await workspace(), translator);
    await expect(service.translate(['Hello'], 'fr')).resolves.toEqual(['Hello']);
  });

  it('only sends uncached unique texts', async () => {
    const translator = new FakeTranslator();
    const service = new TranslationService(await workspace(), translator);

    await service.translate(['One'], 'fr');
    await expect(service.translate(['One', 'Two', 'Two'], 'fr')).resolves.toEqual([
      'FR One',
      'FR Two',
      'FR Two',
    ]);
    expect(translator.calls).toEqual([['One'], ['Two']]);
  });
});
