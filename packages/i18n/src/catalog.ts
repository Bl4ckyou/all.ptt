import { FluentBundle, FluentResource, type FluentVariable } from '@fluent/bundle';
import { DEFAULT_LOCALE } from './locales.js';

export type CatalogSources = Record<string, string>;

export class Translator {
  private readonly bundles = new Map<string, FluentBundle>();

  constructor(
    private readonly locale: string,
    sources: CatalogSources,
    private readonly defaultLocale: string = DEFAULT_LOCALE,
  ) {
    this.build(locale, sources[locale]);
    if (locale !== defaultLocale) this.build(defaultLocale, sources[defaultLocale]);
  }

  private build(locale: string, source: string | undefined): void {
    if (!source) return;
    const bundle = new FluentBundle(locale, { useIsolating: false });
    bundle.addResource(new FluentResource(source));
    this.bundles.set(locale, bundle);
  }

  t(key: string, args?: Record<string, FluentVariable>): string {
    for (const locale of [this.locale, this.defaultLocale]) {
      const bundle = this.bundles.get(locale);
      const message = bundle?.getMessage(key);
      if (!bundle || !message?.value) continue;

      const errors: Error[] = [];
      const formatted = bundle.formatPattern(message.value, args, errors);
      if (errors.length === 0) return formatted;
    }
    return key;
  }
}
