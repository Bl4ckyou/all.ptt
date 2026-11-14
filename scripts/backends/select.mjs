function substitute(pattern, context) {
  return pattern.replace(/\{(\w+)\}/g, (_match, key) => String(context[key] ?? ''));
}

function toRegExp(pattern, context) {
  return new RegExp(substitute(pattern, context), 'i');
}

function rankOf(name, preferences) {
  for (let index = 0; index < preferences.length; index++) {
    if (preferences[index].test(name)) return index;
  }
  return Number.MAX_SAFE_INTEGER;
}

// Pick the best asset for the first candidate target that has a match.
export function selectAsset(assets, selection, candidates, context) {
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

      return { target, asset: ordered[0] };
    }
  }
  return null;
}
