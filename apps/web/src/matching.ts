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

export function baseArchitecture(architecture: string | null | undefined): string {
  return (architecture ?? '').toLowerCase().replace(/[-_](assistant|draft|dflash|dspark|mtp)$/, '');
}

// Match a multimodal projector to a model, using repository and name tokens.
export function mmprojMatchScore(file: LocalModelInfo, model: LocalModelInfo | null): number {
  if (!model) return 0;

  let score = 0;
  if (repositoryKey(file.path) === repositoryKey(model.path)) score += 100;

  const modelTokens = nameTokens(model.name);
  for (const token of nameTokens(file.name)) {
    if (modelTokens.has(token)) score += 10;
  }
  return score;
}

// Match a draft/assistant model using GGUF metadata first, then names.
export function draftMatchScore(file: LocalModelInfo, model: LocalModelInfo | null): number {
  if (!model) return 0;

  let score = 0;
  const fileArchitecture = baseArchitecture(file.architecture);
  const modelArchitecture = baseArchitecture(model.architecture);

  if (fileArchitecture && modelArchitecture) {
    if (fileArchitecture !== modelArchitecture) return 0;
    score += 50;
  }

  if (file.contextLength && model.contextLength) {
    if (file.contextLength !== model.contextLength) return 0;
    score += 50;
  }

  if (repositoryKey(file.path) === repositoryKey(model.path)) score += 100;

  const modelTokens = nameTokens(model.name);
  for (const token of nameTokens(file.name)) {
    if (modelTokens.has(token)) score += 10;
  }
  return score;
}

export function draftCategory(
  name: string,
):
  | 'assistant'
  | 'dflash'
  | 'dflash2'
  | 'dspark'
  | 'eagle3'
  | 'lilicorr'
  | 'mtp'
  | 'other' {
  const lower = name.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  const has = (word: string): boolean =>
    new RegExp(`(^|[-_. ])${word}([-_. ]|$)`, 'i').test(lower);

  if (compact.includes('lilicorr')) return 'lilicorr';
  if (compact.includes('eagle3')) return 'eagle3';
  if (compact.includes('dflash2')) return 'dflash2';
  if (has('dspark')) return 'dspark';
  if (has('dflash')) return 'dflash';
  if (has('mtp')) return 'mtp';
  if (has('assistant') || has('draft')) return 'assistant';
  return 'other';
}
