import type { LocalModelInfo } from './types.js';

export function repositoryKey(path: string): string {
  const index = path.indexOf('/snapshots/');
  return index >= 0 ? path.slice(0, index) : path.slice(0, Math.max(path.lastIndexOf('/'), 0));
}

export function nameTokens(name: string): Set<string> {
  const ignored = new Set(['gguf', 'model', 'models', 'mmproj', 'mtp', 'instruct', 'chat', 'base', 'it']);

  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (token) =>
          token.length > 2 &&
          !ignored.has(token) &&
          !/^\d+(\.\d+)?b$/.test(token) &&
          !/^(q|iq|f|bf)\d/i.test(token) &&
          !/^\d+bit$/.test(token),
      ),
  );
}

// Score how likely a file belongs to the selected model.
export function modelMatchScore(file: LocalModelInfo, model: LocalModelInfo | null): number {
  if (!model) return 0;

  let score = 0;
  if (repositoryKey(file.path) === repositoryKey(model.path)) score += 100;

  const modelTokens = nameTokens(model.name);
  for (const token of nameTokens(file.name)) {
    if (modelTokens.has(token)) score += 10;
  }
  return score;
}

export function draftCategory(name: string): 'assistant' | 'dflash' | 'dspark' | 'mtp' | 'other' {
  const lower = name.toLowerCase();
  if (/(^|[-_.])dflash/i.test(lower)) return 'dflash';
  if (/(^|[-_.])dspark/i.test(lower)) return 'dspark';
  if (/(^|[-_.])mtp/i.test(lower)) return 'mtp';
  if (/(^|[-_.])(assistant|draft)/i.test(lower)) return 'assistant';
  return 'other';
}
