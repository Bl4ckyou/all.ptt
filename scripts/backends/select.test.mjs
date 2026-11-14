import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidateTargets, recommendBackend, variantTargets } from './detect.mjs';
import { selectAsset } from './select.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../../backends.json', import.meta.url), 'utf8'),
);
const context = { cpu: 'avx2', cuda: '12.8', os: 'linux', arch: 'x64' };

function asset(name) {
  return { name, url: `https://example.test/${name}`, size: 1 };
}

describe('selectAsset', () => {
  it('prefers cuda 12.x over newer cuda for llama.cpp', () => {
    const assets = [
      asset('llama-b1-bin-ubuntu-cuda-13.5-x64.tar.gz'),
      asset('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz'),
      asset('llama-b1-bin-ubuntu-x64.tar.gz'),
    ];
    const result = selectAsset(
      assets,
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu'],
      context,
    );
    expect(result.target).toBe('linux-x64-cuda');
    expect(result.asset.name).toBe('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz');
  });

  it('falls back to the cpu build when gpu builds are missing', () => {
    const result = selectAsset(
      [asset('llama-b1-bin-ubuntu-x64.tar.gz')],
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu'],
      context,
    );
    expect(result.target).toBe('linux-x64-cpu');
  });

  it('picks the matching ik_llama cpu variant', () => {
    const assets = [
      asset('ik_llama-main-x-bin-ubuntu-x64-avx2.zip'),
      asset('ik_llama-main-x-bin-ubuntu-x64-avx512.zip'),
    ];
    const result = selectAsset(
      assets,
      manifest.backends['ik-llama-cpp'].selection,
      ['linux-x64-cpu'],
      { ...context, cpu: 'avx512' },
    );
    expect(result.asset.name).toBe('ik_llama-main-x-bin-ubuntu-x64-avx512.zip');
  });

  it('ignores cudart-only assets', () => {
    const result = selectAsset(
      [
        asset('cudart-llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz'),
        asset('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz'),
      ],
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda'],
      context,
    );
    expect(result.asset.name).toBe('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz');
  });
});

describe('candidateTargets', () => {
  it('puts cuda first for a linux nvidia machine', () => {
    expect(
      candidateTargets({ os: 'linux', arch: 'x64', gpu: { vendor: 'nvidia' } }),
    ).toEqual(['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu']);
  });

  it('uses metal on apple silicon', () => {
    expect(
      candidateTargets({ os: 'darwin', arch: 'arm64', gpu: { vendor: 'apple' } }),
    ).toEqual(['darwin-arm64-metal', 'darwin-x64-cpu']);
  });

  it('uses cpu when no gpu is present', () => {
    expect(
      candidateTargets({ os: 'linux', arch: 'x64', gpu: { vendor: 'none' } }),
    ).toEqual(['linux-x64-cpu']);
  });
});

describe('variantTargets', () => {
  const nvidia = {
    os: 'linux',
    arch: 'x64',
    cpu: 'avx2',
    gpu: { vendor: 'nvidia' },
    targets: ['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu'],
  };

  it('auto never picks cuda (opt-in only)', () => {
    expect(variantTargets('auto', nvidia)).toEqual(['linux-x64-vulkan', 'linux-x64-cpu']);
  });

  it('maps explicit variants to a single target', () => {
    expect(variantTargets('cuda', nvidia)).toEqual(['linux-x64-cuda']);
    expect(variantTargets('cpu', nvidia)).toEqual(['linux-x64-cpu']);
  });

  it('rejects vulkan on arm', () => {
    expect(variantTargets('vulkan', { os: 'linux', arch: 'arm64', targets: [] })).toEqual([]);
  });
});

describe('recommendBackend', () => {
  const defaults = manifest.defaults;

  it('picks ik_llama.cpp for cpu-only x86', () => {
    expect(
      recommendBackend(
        { os: 'linux', arch: 'x64', cpu: 'avx2', gpu: { vendor: 'none' } },
        defaults,
      ),
    ).toBe('ik-llama-cpp');
  });

  it('picks llama.cpp when a discrete gpu is present', () => {
    expect(
      recommendBackend(
        { os: 'linux', arch: 'x64', cpu: 'avx2', gpu: { vendor: 'nvidia' } },
        defaults,
      ),
    ).toBe('llama-cpp');
  });
});

describe('manifest', () => {
  it('does not claim vulkan or metal support for ik_llama.cpp', () => {
    const targets = manifest.backends['ik-llama-cpp'].selection.flatMap((rule) => rule.targets);
    expect(targets.some((key) => key.includes('vulkan'))).toBe(false);
    expect(targets.some((key) => key.includes('metal') || key.includes('darwin'))).toBe(false);
  });
});
