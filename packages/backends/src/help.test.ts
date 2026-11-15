import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHelpSettings, discoverQuantTypes, parseHelpOptions } from './help.js';
import type { BackendEntry } from './types.js';

const LLAMA_HELP = `
  -c,    --ctx-size N                     size of the prompt context (default: 0, 0 = loaded from model)
  -t,    --threads N                      number of CPU threads to use during generation (default: -1)
  -fa,   --flash-attn [on|off|auto]       set Flash Attention use ('on', 'off', or 'auto', default: 'auto')
  -kvo,  --kv-offload, -nkvo, --no-kv-offload
                                          offload host to device
  -sm,   --split-mode {none,layer,row,tensor}
  --spec-type SPEC[:k=v,...]              speculative decoding type
`;

const IK_HELP = `
  -t,    --threads N              number of threads to use during generation (default: 4)
  --flash-attn (auto|on|off|0|1)
  --spec-type SPEC[:k=v,...]      canonical speculative stage entry
  --no-mmap: do not memory-map the model
`;

function backend(settings: BackendEntry['settings'] = {}): BackendEntry {
  return {
    label: 'Test',
    repo: 'test',
    defaultVariant: 'auto',
    binaries: ['server'],
    selection: [],
    settings,
  };
}

describe('parseHelpOptions', () => {
  it('parses the llama.cpp aligned format', () => {
    const options = parseHelpOptions(LLAMA_HELP);
    const byId = new Map(options.map((option) => [option.id, option]));

    expect(byId.get('ctx-size')).toMatchObject({ kind: 'number', flag: '--ctx-size' });
    expect(byId.get('threads')).toMatchObject({ kind: 'number', flag: '--threads' });
    expect(byId.get('flash-attn')).toMatchObject({
      kind: 'enum',
      choices: ['on', 'off', 'auto'],
    });
    expect(byId.get('kv-offload')).toMatchObject({
      kind: 'boolean',
      flag: '--kv-offload',
      negated: false,
      description: 'offload host to device',
    });
    expect(byId.get('kv-offload')?.aliases).toContain('--no-kv-offload');
    expect(byId.get('split-mode')?.choices).toEqual(['none', 'layer', 'row', 'tensor']);
  });

  it('does not leak skipped option descriptions into the next option', () => {
    const options = parseHelpOptions(
      '--completion-bash   print bash completion\n-t, --threads N   number of threads',
    );
    const threads = options.find((option) => option.id === 'threads');
    expect(threads?.description).toBe('number of threads');
  });

  it('parses several options on one line and lowercase metavars', () => {
    const options = parseHelpOptions(
      '--top-k N --top-p F --temperature F\n--vision             --serve takes images too',
    );
    const byId = new Map(options.map((option) => [option.id, option]));
    expect(byId.get('top-k')).toMatchObject({ kind: 'number', flag: '--top-k' });
    expect(byId.get('top-p')).toMatchObject({ kind: 'number', flag: '--top-p' });
    expect(byId.get('temperature')?.kind).toBe('number');
    expect(byId.get('vision')).toMatchObject({ kind: 'boolean', flag: '--vision' });
    expect(byId.get('vision')?.description).toBe('--serve takes images too');
  });

  it('does not swallow section separators into descriptions', () => {
    const options = parseHelpOptions(
      '--backend-sampling   enable backend sampling\n----- speculative params -----\n--spec-type TYPE   speculative type',
    );
    const byId = new Map(options.map((option) => [option.id, option]));
    expect(byId.get('backend-sampling')?.description).toBe('enable backend sampling');
    expect(byId.get('spec-type')?.description).toBe('speculative type');
  });

  it('joins wrapped descriptions that continue with a flag mention', () => {
    const options = parseHelpOptions(
      [
        '--ignore-eos                            ignore end of stream token and continue generating (implies',
        '                                        --logit-bias EOS-inf)',
        '--temp, --temperature N                 temperature (default: 0.80)',
      ].join('\n'),
    );
    const byId = new Map(options.map((option) => [option.id, option]));
    expect(byId.get('ignore-eos')?.description).toBe(
      'ignore end of stream token and continue generating (implies --logit-bias EOS-inf)',
    );
    expect(byId.get('temperature')?.description).toBe('temperature (default: 0.80)');
  });

  it('prefers a positive value option over a negated boolean variant', () => {
    const options = parseHelpOptions(
      '--no-flash-attn   disable Flash Attention\n-fa, --flash-attn (auto|on|off)   set Flash Attention',
    );
    const flash = options.find((option) => option.id === 'flash-attn');
    expect(flash).toMatchObject({
      kind: 'enum',
      flag: '--flash-attn',
      negated: false,
    });
    expect(flash?.aliases).toContain('--no-flash-attn');
  });

  it('parses the ik_llama.cpp colon format', () => {
    const options = parseHelpOptions(IK_HELP);
    const byId = new Map(options.map((option) => [option.id, option]));

    expect(byId.get('threads')?.kind).toBe('number');
    expect(byId.get('flash-attn')?.choices).toEqual(['auto', 'on', 'off', '0', '1']);
    expect(byId.get('spec-type')).toMatchObject({ kind: 'string' });
    expect(byId.get('mmap')).toMatchObject({
      kind: 'boolean',
      flag: '--no-mmap',
      negated: true,
      description: 'do not memory-map the model',
    });
  });
});

describe('buildHelpSettings', () => {
  it('skips flags already covered by curated settings', () => {
    const result = buildHelpSettings(
      backend({ 'context-size': '--ctx-size' }),
      parseHelpOptions(LLAMA_HELP),
    );
    expect(result.settings['ctx-size']).toBeUndefined();
    expect(result.settings['context-size']).toBeUndefined();
    expect(result.settings.threads).toBe('--threads');
  });

  it('generates typed settings with labels and descriptions', () => {
    const result = buildHelpSettings(backend(), parseHelpOptions(LLAMA_HELP));

    expect(result.settings.threads).toBe('--threads');
    expect(result.catalog.threads).toMatchObject({
      type: 'number',
      label: 'Threads',
      category: 'cpu',
    });
    expect(result.catalog.threads?.default).toBeUndefined();
    expect(result.catalog['flash-attn']).toMatchObject({
      type: 'enum',
      choices: ['on', 'off', 'auto'],
      category: 'gpu',
    });
  });

  it('filters launcher-managed, preset and removed flags', () => {
    const options = parseHelpOptions(
      [
        '--model PATH   model path',
        '--port N   port to listen',
        '--draft N   the argument has been removed. use --spec-draft-n-max',
        '--fim-qwen-7b-default   use a preset',
        '--cache-list   show list of models in cache',
        '--ctx-size N   context size',
      ].join('\n'),
    );
    const result = buildHelpSettings(backend(), options);
    expect(Object.keys(result.settings)).toEqual(['ctx-size']);
  });

  it('hides server and admin flags, and clarifies ambiguous labels', () => {
    const options = parseHelpOptions(
      [
        '--cors-origins LIST   allowed origins',
        '--api-key KEY   api key',
        '--models-max N   router models',
        '--log-file PATH   log file',
        '--threads-http N   http threads',
        '--mmproj-auto   auto multimodal projector',
        '--n-predict N   tokens to predict',
        '--ctx-checkpoints N   checkpoints',
      ].join('\n'),
    );
    const result = buildHelpSettings(backend(), options);
    expect(Object.keys(result.settings).sort()).toEqual([
      'ctx-checkpoints',
      'mmproj-auto',
      'n-predict',
    ]);
    expect(result.catalog['n-predict']?.label).toBe('Tokens to predict');
    expect(result.catalog['ctx-checkpoints']?.label).toBe('Context checkpoints');
  });

  it('maps negated-only flags with invert', () => {
    const result = buildHelpSettings(backend(), parseHelpOptions(IK_HELP));
    expect(result.settings.mmap).toEqual({ flag: '--no-mmap', invert: true });
    expect(result.catalog.mmap?.type).toBe('boolean');
  });
});

describe('discoverQuantTypes', () => {
  it.skipIf(process.platform === 'win32')('reads quants from the sibling llama-quantize', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptt-quant-'));
    try {
      await writeFile(join(directory, 'llama-server'), '');
      const quantize = join(directory, 'llama-quantize');
      await writeFile(
        quantize,
        '#!/bin/sh\nprintf "    12 or Q3_K : alias for Q3_K_M\\n   135 or Q6_0 : extra quant\\n"\n',
      );
      await chmod(quantize, 0o755);

      const types = await discoverQuantTypes(join(directory, 'llama-server'));
      expect(types?.[135]).toBe('Q6_0');
      expect(types?.[12]).toBe('Q3_K');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns null when no llama-quantize exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ptt-quant-'));
    try {
      await writeFile(join(directory, 'llama-server'), '');
      await expect(discoverQuantTypes(join(directory, 'llama-server'))).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
