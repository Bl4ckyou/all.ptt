import {
  discoverQuantTypes,
  mergeFileTypeNames,
  readInstalledStates,
} from '@ptt/backends';

let signature = '';

export async function refreshQuantTypes(root: string): Promise<void> {
  const states = await readInstalledStates(root);
  const binaries = [
    ...new Set(
      Object.values(states)
        .flatMap((state) => Object.values(state.variants).map((variant) => variant.binary))
        .filter(Boolean),
    ),
  ].sort();

  const next = binaries.join('|');
  if (next === signature) return;
  signature = next;

  for (const binary of binaries) {
    try {
      const types = await discoverQuantTypes(binary);
      if (types) mergeFileTypeNames(types);
    } catch {
      // a backend without llama-quantize still works, just with the built-in table
    }
  }
}
