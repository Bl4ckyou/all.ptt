const PLACEHOLDER = /[\uE000](\d+)[\uE001]/g;

const TOKEN_PATTERNS: RegExp[] = [
  /`[^`]+`/g,
  /https?:\/\/[^\s)]+/g,
  /--[a-zA-Z0-9][a-zA-Z0-9-]*/g,
  /\{[a-zA-Z0-9_-]+\}/g,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
  /\b(?:F16|F32|BF16|FP8|NVFP4)\b/g,
];

export interface ProtectedText {
  masked: string;
  tokens: string[];
}

export function protectTokens(text: string): ProtectedText {
  let masked = text;
  const tokens: string[] = [];

  for (const pattern of TOKEN_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const index = tokens.push(match) - 1;
      return `\uE000${index}\uE001`;
    });
  }

  return { masked, tokens };
}

export function restoreTokens(masked: string, tokens: string[]): string | null {
  const present = new Set([...masked.matchAll(PLACEHOLDER)].map((match) => Number(match[1])));
  for (let index = 0; index < tokens.length; index += 1) {
    if (!present.has(index)) return null;
  }

  return masked.replace(PLACEHOLDER, (_match, raw: string) => tokens[Number(raw)] ?? '');
}

export function isTranslationModel(
  tags: readonly string[] | undefined,
  chatTemplate?: string | null,
): boolean {
  if (/target_lang/.test(chatTemplate ?? '')) return true;
  return (tags ?? []).some((tag) => /translat/i.test(tag));
}

export function baseLanguage(locale: string): string {
  return locale.toLowerCase().split(/[-_]/)[0];
}

export function languageName(locale: string): string {
  const base = baseLanguage(locale);
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(base) ?? locale;
  } catch {
    return locale;
  }
}
