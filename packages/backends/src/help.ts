import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  BackendEntry,
  SettingCategory,
  SettingDefinition,
  SettingMapping,
  SettingsCatalog,
} from './types.js';

export interface HelpOption {
  id: string;
  flag: string;
  aliases: string[];
  negated: boolean;
  kind: 'boolean' | 'number' | 'string' | 'enum';
  choices?: string[];
  description: string;
  default?: string;
}

const SKIP = new Set([
  'help',
  'version',
  'usage',
  'list-devices',
  'completion-bash',
  'completion-zsh',
]);

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function enumChoices(token: string): string[] | null {
  const bracketed = token.match(/^[<[{(](.+)[>\]})]$/);
  const inner = bracketed ? bracketed[1] : token;
  if (!bracketed && !/[|]/.test(inner)) return null;

  const parts = inner
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9_.+-]+$/.test(part));
  if (parts.length < 2 || parts.some((part) => part.length > 24)) return null;
  return parts;
}

function looksNumber(token: string): boolean {
  return /(^|[^A-Z])(N|NUM|INT|SIZE|COUNT|INDEX|PORT|LAYERS|GPU|THREADS?|CTX|TOKENS?)([^A-Z]|$)/.test(
    token,
  );
}

function isMetavar(token: string): boolean {
  if (!token || /\s/.test(token)) return false;
  if (/^[<[{(]/.test(token)) return true;
  if (/[|,]/.test(token)) return true;
  return /^[A-Z][A-Z0-9_,.:=<>[\]{}-]*$/.test(token);
}

function splitRest(rest: string): { metavar: string; description: string } {
  const value = rest.trim();
  if (!value) return { metavar: '', description: '' };

  const parts = value.split(/\s{2,}/);
  if (parts.length > 1) {
    return {
      metavar: isMetavar(parts[0]) ? parts[0] : '',
      description: parts.slice(1).join(' '),
    };
  }

  return isMetavar(value)
    ? { metavar: value, description: '' }
    : { metavar: '', description: value };
}

function makeOption(longs: string[], metavar: string): HelpOption | null {
  const positive = longs.find((flag) => !flag.startsWith('--no-'));
  const negative = longs.find((flag) => flag.startsWith('--no-'));
  const flag = positive ?? negative;
  if (!flag) return null;

  const negated = !positive && !!negative;
  const id = flag.replace(/^--/, '').replace(/^no-/, '');
  if (!id || SKIP.has(id)) return null;

  const choices = metavar ? enumChoices(metavar) : null;
  const kind = !metavar ? 'boolean' : choices ? 'enum' : looksNumber(metavar) ? 'number' : 'string';

  return {
    id,
    flag,
    aliases: longs,
    negated,
    kind,
    choices: choices ?? undefined,
    description: '',
  };
}

export function parseHelpOptions(text: string): HelpOption[] {
  const options = new Map<string, HelpOption>();
  let current: HelpOption | null = null;
  let description: string[] = [];

  const flush = (): void => {
    if (current) {
      current.description = clean(description.join(' '));
      const existing = options.get(current.id);
      if (existing) {
        const aliases = [...new Set([...existing.aliases, ...current.aliases])];
        if (existing.negated && !current.negated) {
          Object.assign(existing, current, { aliases });
        } else {
          existing.aliases = aliases;
          if (!existing.description) existing.description = current.description;
        }
      } else {
        options.set(current.id, current);
      }
    }
    current = null;
    description = [];
  };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const match = line.match(
      /^\s*((?:-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)(?:\s*,\s*-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)*)(.*)$/,
    );

    if (!match || !match[1].includes('--')) {
      if (current && line.trim()) description.push(line.trim());
      continue;
    }

    const aliases = match[1]
      .split(',')
      .map((alias) => alias.trim())
      .filter(Boolean);
    const longs = aliases.filter((alias) => alias.startsWith('--'));
    if (longs.length === 0) {
      if (current && line.trim()) description.push(line.trim());
      continue;
    }

    flush();
    const rest = match[2].replace(/^\s*:?\s*/, '');
    const { metavar, description: inline } = splitRest(rest);
    current = makeOption(longs, metavar);
    if (inline) description.push(inline);
  }

  flush();
  return [...options.values()];
}

function categoryOf(id: string): SettingCategory {
  if (/gpu|cuda|vulkan|rocm|metal|tensor-split|split-mode|offload|flash-attn|cache-type/.test(id)) {
    return 'gpu';
  }
  if (/temp|top-|min-p|repeat|seed|sampl|penalty|mirostat|dry/.test(id)) return 'sampling';
  if (/spec|draft|mtp|ngram|suffix/.test(id)) return 'speculative';
  if (/thread|cpu|affinity|numa/.test(id)) return 'cpu';
  if (/model|mmproj|lora|vocab|embed|ctx|context|batch|ubatch/.test(id)) return 'model';
  return 'performance';
}

function humanize(id: string): string {
  const text = id.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface HelpSettings {
  settings: Record<string, SettingMapping>;
  catalog: SettingsCatalog;
}

export function buildHelpSettings(backend: BackendEntry, options: HelpOption[]): HelpSettings {
  const known = new Set<string>();
  for (const mapping of Object.values(backend.settings ?? {})) {
    const flag = typeof mapping === 'string' ? mapping : mapping.flag;
    if (flag) known.add(flag);
  }

  const settings: Record<string, SettingMapping> = {};
  const catalog: SettingsCatalog = {};
  const advanced = Object.keys(backend.settings ?? {}).length > 0;

  for (const option of options) {
    if (option.aliases.some((alias) => known.has(alias)) || known.has(option.flag)) continue;
    if (settings[option.id]) continue;

    const definition: SettingDefinition = {
      type: option.kind,
      category: categoryOf(option.id),
      advanced,
      label: humanize(option.id),
      description: option.description || option.flag,
    };
    if (option.choices) definition.choices = option.choices;

    // No default on generated settings: they are only emitted when explicitly set.
    // Otherwise a single "save" would launch the backend with hundreds of flags.
    settings[option.id] =
      option.kind === 'boolean'
        ? { flag: option.flag, ...(option.negated ? { invert: true } : {}) }
        : option.flag;
    catalog[option.id] = definition;
  }

  return { settings, catalog };
}

function runOutput(binary: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

export function readHelpOutput(binary: string): Promise<string | null> {
  return runOutput(binary, ['--help']);
}

function parseQuantTypes(text: string): Record<number, string> {
  const types: Record<number, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+or\s+([A-Z0-9_]+)\s*:/);
    if (match) types[Number(match[1])] = match[2];
  }
  return types;
}

async function siblingQuantize(binary: string): Promise<string | null> {
  const directory = dirname(binary);
  for (const name of ['llama-quantize', 'llama-quantize.exe']) {
    const candidate = join(directory, name);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // try the next name
    }
  }
  return null;
}

const quantCache = new Map<string, { mtimeMs: number; types: Record<number, string> }>();

export async function discoverQuantTypes(
  binary: string,
): Promise<Record<number, string> | null> {
  const quantize = await siblingQuantize(binary);
  if (!quantize) return null;

  let mtimeMs: number;
  try {
    mtimeMs = (await stat(quantize)).mtimeMs;
  } catch {
    return null;
  }

  const cached = quantCache.get(quantize);
  if (cached && cached.mtimeMs === mtimeMs) return cached.types;

  const [plain, help] = await Promise.all([
    runOutput(quantize, []),
    runOutput(quantize, ['--help']),
  ]);
  const types = { ...parseQuantTypes(plain ?? ''), ...parseQuantTypes(help ?? '') };
  if (Object.keys(types).length === 0) return null;

  quantCache.set(quantize, { mtimeMs, types });
  return types;
}

const optionCache = new Map<string, { mtimeMs: number; options: HelpOption[] }>();

export async function discoverHelpOptions(binary: string): Promise<HelpOption[] | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(binary)).mtimeMs;
  } catch {
    return null;
  }

  const cached = optionCache.get(binary);
  if (cached && cached.mtimeMs === mtimeMs) return cached.options;

  const help = await readHelpOutput(binary);
  const options = help ? parseHelpOptions(help) : null;
  if (options) optionCache.set(binary, { mtimeMs, options });
  return options;
}

export async function resolveBackend(
  binary: string | null,
  backend: BackendEntry,
  catalog: SettingsCatalog,
): Promise<{ backend: BackendEntry; catalog: SettingsCatalog; probed: boolean }> {
  const options = binary ? await discoverHelpOptions(binary) : null;
  if (!options) return { backend, catalog, probed: false };

  const generated = buildHelpSettings(backend, options);
  return {
    backend: {
      ...backend,
      settings: { ...generated.settings, ...(backend.settings ?? {}) },
    },
    catalog: { ...catalog, ...generated.catalog },
    probed: true,
  };
}
