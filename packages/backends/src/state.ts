import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstalledState, InstalledVariant } from './types.js';

export function backendDir(root: string, id: string): string {
  return join(root, '.backends', id);
}

export function installedStatePath(root: string, id: string): string {
  return join(backendDir(root, id), 'installed.json');
}

function emptyState(backend: string): InstalledState {
  return { backend, variants: {} };
}

export async function readInstalledState(root: string, id: string): Promise<InstalledState> {
  try {
    const raw = JSON.parse(await readFile(installedStatePath(root, id), 'utf8')) as Partial<InstalledState> & {
      target?: string;
      variant?: string;
    };

    if (raw.variants) return { backend: id, variants: raw.variants };
    if (raw.target) {
      const record = raw as unknown as InstalledVariant;
      return { backend: id, variants: { [raw.target]: { ...record, variant: raw.variant ?? 'auto', legacy: true } } };
    }
  } catch {
    // no state yet
  }
  return emptyState(id);
}

export async function readInstalledStates(root: string): Promise<Record<string, InstalledState>> {
  const base = join(root, '.backends');
  let entries: string[];
  try {
    entries = (await readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return {};
  }

  const states: Record<string, InstalledState> = {};
  for (const id of entries) states[id] = await readInstalledState(root, id);
  return states;
}

export async function resolveInstalledBinary(
  root: string,
  id?: string,
): Promise<{ backendId: string; record: InstalledVariant } | null> {
  if (id) {
    const state = await readInstalledState(root, id);
    const record = Object.values(state.variants).find((entry) => entry.binary);
    return record ? { backendId: id, record } : null;
  }

  const states = await readInstalledStates(root);
  for (const [backendId, state] of Object.entries(states)) {
    const record = Object.values(state.variants).find((entry) => entry.binary);
    if (record) return { backendId, record };
  }
  return null;
}
