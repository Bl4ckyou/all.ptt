import { describe, expect, it } from 'vitest';
import { loadManifest } from './manifest.js';
import { buildSettingArgs, parseExtraArgs, parseLongFlags } from './settings.js';

const manifest = loadManifest();

describe('parseLongFlags', () => {
  it('collects long flags from help output', () => {
    const flags = parseLongFlags('-c, --ctx-size N context\n--flash-attn [on|off]\n--no-mmap');
    expect(flags.has('--ctx-size')).toBe(true);
    expect(flags.has('--flash-attn')).toBe(true);
    expect(flags.has('--no-mmap')).toBe(true);
  });
});

describe('parseExtraArgs', () => {
  it('splits arguments and keeps quoted values together', () => {
    expect(parseExtraArgs('--foo "bar baz" --qux')).toEqual(['--foo', 'bar baz', '--qux']);
  });
});

describe('buildSettingArgs', () => {
  it('maps semantic settings to llama.cpp flags', () => {
    const args = buildSettingArgs(
      manifest.backends['llama-cpp'],
      manifest.settings,
      {
        'context-size': 4096,
        'gpu-layers': 20,
        'flash-attention': 'on',
        parallel: 2,
      },
      '--foo',
    );
    expect(args).toEqual([
      '--ctx-size',
      '4096',
      '--n-gpu-layers',
      '20',
      '--flash-attn',
      'on',
      '--parallel',
      '2',
      '--foo',
    ]);
  });

  it('uses backend-specific names and inverts boolean mappings', () => {
    const ik = manifest.backends['ik-llama-cpp'];
    const args = buildSettingArgs(ik, manifest.settings, {
      'gpu-layers': 10,
      mmap: false,
      mlock: true,
    });
    expect(args).toEqual(['--gpu-layers', '10', '--no-mmap', '--mlock']);
  });

  it('omits an inverted flag when the semantic value is true', () => {
    const ik = manifest.backends['ik-llama-cpp'];
    expect(buildSettingArgs(ik, manifest.settings, { mmap: true })).toEqual([]);
  });

  it('maps CPU range to both backends', () => {
    expect(
      buildSettingArgs(manifest.backends['llama-cpp'], manifest.settings, { 'cpu-range': '0-7' }),
    ).toEqual(['--cpu-range', '0-7']);
    expect(
      buildSettingArgs(manifest.backends['ik-llama-cpp'], manifest.settings, { 'cpu-range': '0-7' }),
    ).toEqual(['--cpu-range', '0-7']);
  });

  it('treats ik CPU affinity as a boolean Linux-only flag', () => {
    const ik = manifest.backends['ik-llama-cpp'];
    expect(buildSettingArgs(ik, manifest.settings, { 'cpu-affinity': true })).toEqual([
      '--cpu-affinity',
    ]);
    expect(buildSettingArgs(ik, manifest.settings, { 'cpu-affinity': false })).toEqual([]);
    expect(
      buildSettingArgs(manifest.backends['llama-cpp'], manifest.settings, { 'cpu-affinity': true }),
    ).toEqual([]);
    expect(manifest.settings['cpu-affinity'].platforms).toEqual(['linux']);
  });

  it('maps repacking with backend-specific polarity', () => {
    const llama = manifest.backends['llama-cpp'];
    const ik = manifest.backends['ik-llama-cpp'];
    expect(buildSettingArgs(llama, manifest.settings, { repack: false })).toEqual(['--no-repack']);
    expect(buildSettingArgs(llama, manifest.settings, { repack: true })).toEqual([]);
    expect(buildSettingArgs(ik, manifest.settings, { repack: true })).toEqual(['--run-time-repack']);
    expect(buildSettingArgs(ik, manifest.settings, { repack: false })).toEqual([]);
  });

  it('maps merge-qkv on ik only', () => {
    expect(
      buildSettingArgs(manifest.backends['ik-llama-cpp'], manifest.settings, { 'merge-qkv': true }),
    ).toEqual(['--merge-qkv']);
    expect(
      buildSettingArgs(manifest.backends['llama-cpp'], manifest.settings, { 'merge-qkv': true }),
    ).toEqual([]);
  });

  it('maps draft and multimodal settings', () => {
    expect(
      buildSettingArgs(manifest.backends['llama-cpp'], manifest.settings, {
        'draft-model': '/models/draft.gguf',
        'draft-gpu-layers': 10,
        mmproj: '/models/mmproj.gguf',
        'mmproj-offload': false,
      }),
    ).toEqual([
      '--model-draft',
      '/models/draft.gguf',
      '--gpu-layers-draft',
      '10',
      '--mmproj',
      '/models/mmproj.gguf',
      '--no-mmproj-offload',
    ]);
  });

  it('maps ik-specific mtp and spec-type settings', () => {
    expect(
      buildSettingArgs(manifest.backends['ik-llama-cpp'], manifest.settings, {
        'mtp-requantize': 'q8_0',
        'spec-type': 'mtp:n_max=1',
      }),
    ).toEqual(['--mtp-requantize-output-tensor', 'q8_0', '--spec-type', 'mtp:n_max=1']);
  });
});
