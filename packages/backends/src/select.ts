import type { ReleaseAsset, SelectionRule } from './types.js';

function substitute(pattern: string, context: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_match, key: string) => context[key] ?? '');
}

function toRegExp(pattern: string, context: Record<string, string>): RegExp {
  return new RegExp(substitute(pattern, context), 'i');
}

function rankOf(name: string, preferences: RegExp[]): number {
  for (let index = 0; index < preferences.length; index++) {
    if (preferences[index].test(name)) return index;
  }
  return Number.MAX_SAFE_INTEGER;
}

export interface AssetSelection {
  target: string;
  asset: ReleaseAsset;
  runtime?: ReleaseAsset;
}

// Pick the best asset for the first candidate target that has a match.
export function selectAsset(
  assets: ReleaseAsset[],
  selection: SelectionRule[],
  candidates: string[],
  context: Record<string, string>,
): AssetSelection | null {
  for (const target of candidates) {
    for (const rule of selection) {
      if (!rule.targets.includes(target)) continue;

      const include = toRegExp(rule.include, context);
      const excludes = (rule.exclude ?? []).map((pattern) => toRegExp(pattern, context));
      const matches = assets.filter(
        (asset) => include.test(asset.name) && !excludes.some((regex) => regex.test(asset.name)),
      );
      if (matches.length === 0) continue;

      const preferences = (rule.prefer ?? []).map((pattern) => toRegExp(pattern, context));
      const ordered = matches
        .map((asset, index) => ({ asset, index, rank: rankOf(asset.name, preferences) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((entry) => entry.asset);

      const runtimeCandidates = rule.runtime
        ? assets.filter(
            (asset) => asset !== ordered[0] && toRegExp(rule.runtime!, context).test(asset.name),
          )
        : [];
      const binSuffix = ordered[0].name.match(/(-bin-.*)$/)?.[1];
      const runtime = binSuffix
        ? runtimeCandidates.find((asset) => asset.name.endsWith(binSuffix)) ?? runtimeCandidates[0]
        : runtimeCandidates[0];

      return { target, asset: ordered[0], runtime };
    }
  }
  return null;
}
