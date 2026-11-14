import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type {
  BackendEntry,
  ResolvedSetting,
  SettingMapping,
  SettingValue,
  SettingsCatalog,
} from './types.js';

export interface ResolvedSettingWithFlag extends ResolvedSetting {
  flag: string;
  invert?: boolean;
}

interface HelpCacheEntry {
  mtimeMs: number;
  flags: Set<string> | null;
}

const helpCache = new Map<string, HelpCacheEntry>();

export function parseLongFlags(text: string): Set<string> {
  const flags = new Set<string>();
  for (const match of text.matchAll(/--[a-zA-Z0-9][a-zA-Z0-9-]*/g)) {
    flags.add(match[0]);
  }
  return flags;
}

function readHelp(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn(binary, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(output || null);
    }, 6000);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', () => finish(null));
    child.once('exit', () => finish(output || null));
  });
}

// Read the real flags supported by an installed binary (survives renames).
export async function discoverFlags(binary: string): Promise<Set<string> | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(binary)).mtimeMs;
  } catch {
    return null;
  }

  const cached = helpCache.get(binary);
  if (cached && cached.mtimeMs === mtimeMs) return cached.flags;

  const help = await readHelp(binary);
  const flags = help ? parseLongFlags(help) : null;
  helpCache.set(binary, { mtimeMs, flags });
  return flags;
}

function mappingOf(mapping: SettingMapping): { flag: string; invert?: boolean } {
  return typeof mapping === 'string' ? { flag: mapping } : mapping;
}

// Resolve semantic settings for a backend, filtered by the binary's help output.
export async function resolveSettings(
  binary: string | null,
  backend: BackendEntry,
  catalog: SettingsCatalog,
): Promise<{ settings: ResolvedSettingWithFlag[]; probed: boolean }> {
  const discovered = binary ? await discoverFlags(binary) : null;
  const settings: ResolvedSettingWithFlag[] = [];

  for (const [id, mapping] of Object.entries(backend.settings ?? {})) {
    const definition = catalog[id];
    if (!definition) continue;

    const { flag, invert } = mappingOf(mapping);
    if (discovered && !discovered.has(flag)) continue;

    settings.push({ id, ...definition, available: true, flag, invert });
  }

  return { settings, probed: discovered !== null };
}

export function parseExtraArgs(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

// Translate semantic settings back into real backend arguments.
export function buildSettingArgs(
  backend: BackendEntry,
  catalog: SettingsCatalog,
  values: Record<string, SettingValue>,
  extraArgs = '',
): string[] {
  const args: string[] = [];

  for (const [id, value] of Object.entries(values)) {
    const definition = catalog[id];
    const mapping = backend.settings?.[id];
    if (!definition || !mapping) continue;

    const { flag, invert } = mappingOf(mapping);

    if (definition.type === 'boolean') {
      const enabled = value === true || value === 'true';
      const include = invert ? !enabled : enabled;
      if (include) args.push(flag);
      continue;
    }

    if (value === '' || value === null || value === undefined) continue;
    args.push(flag, String(value));
  }

  return [...args, ...parseExtraArgs(extraArgs)];
}
