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
  if (/^[NFSIU]$/i.test(token)) return true;
  return /(^|[^A-Z])(N|NUM|INT|SIZE|COUNT|INDEX|PORT|LAYERS|GPU|THREADS?|CTX|TOKENS?|FLOAT)([^A-Z]|$)/.test(
    token,
  );
}

function splitSpec(content: string): { spec: string; inline: string } {
  const colon = content.match(/^(--[A-Za-z0-9-]+)\s*:\s+(.*)$/);
  if (colon) return { spec: colon[1], inline: colon[2] };

  const separator = /\s{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(content))) {
    const rest = content.slice(match.index).trim();
    if (!/^-{1,2}[A-Za-z0-9]/.test(rest)) {
      return { spec: content.slice(0, match.index), inline: rest };
    }
    if (!/\s{2,}/.test(rest)) {
      // "-kvo,   --kv-offload, --no-kv-offload" is still spec.
      // "--vision   --serve takes images too" is prose.
      let afterAlias = false;
      let specification = true;
      for (const token of rest.split(/\s+/)) {
        if (token.startsWith('-')) {
          afterAlias = true;
        } else if (afterAlias) {
          afterAlias = false;
        } else {
          specification = false;
          break;
        }
      }
      if (!specification) return { spec: content.slice(0, match.index), inline: rest };
    }
  }
  return { spec: content, inline: '' };
}

interface SpecGroup {
  aliases: string[];
  metavar: string;
}

function parseSpec(spec: string): SpecGroup[] {
  const normalized = spec.replace(/,\s*(?=-)/g, ' ');
  const groups: SpecGroup[] = [];
  let aliases: string[] = [];
  let metavar = '';

  const push = (): void => {
    if (aliases.length > 0) groups.push({ aliases, metavar });
    aliases = [];
    metavar = '';
  };

  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('-')) {
      if (aliases.length > 0 && metavar) push();
      for (const part of token.split(',').filter(Boolean)) {
        if (part.startsWith('-')) aliases.push(part);
      }
    } else {
      metavar = metavar ? `${metavar} ${token}` : token;
    }
  }

  push();
  return groups;
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
  let current: HelpOption[] = [];
  let description: string[] = [];

  const flush = (): void => {
    const text = clean(description.join(' '));
    for (const option of current) {
      option.description = text;
      const existing = options.get(option.id);
      if (existing) {
        const aliases = [...new Set([...existing.aliases, ...option.aliases])];
        if (existing.negated && !option.negated) {
          Object.assign(existing, option, { aliases });
        } else {
          existing.aliases = aliases;
          if (!existing.description) existing.description = option.description;
        }
      } else {
        options.set(option.id, option);
      }
    }
    current = [];
    description = [];
  };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const content = line.trim();
    if (!content) continue;

    const indent = line.length - line.trimStart().length;
    const startsLikeOption = content.startsWith('-');
    if (!startsLikeOption || indent >= 6) {
      if (current.length > 0) description.push(content);
      continue;
    }

    const { spec, inline } = splitSpec(content);

    const groups = parseSpec(spec);
    if (!groups.some((group) => group.aliases.some((alias) => alias.startsWith('--')))) {
      if (current.length > 0) description.push(content);
      continue;
    }

    flush();
    current = groups
      .map((group) => makeOption(group.aliases.filter((alias) => alias.startsWith('--')), group.metavar))
      .filter((option): option is HelpOption => option !== null);
    if (inline) description.push(inline.replace(/^:\s*/, ''));
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
