import { describe, expect, it } from 'vitest';
import { candidateTargets, recommendBackend, variantTargets } from './detect.js';
import { loadManifest } from './manifest.js';
import { selectAsset } from './select.js';

const manifest = loadManifest();
const context = { cpu: 'avx2', cuda: '12.8', os: 'linux', arch: 'x64' };

function asset(name: string) {
  return { name, url: `https://example.test/${name}`, size: 1 };
}

describe('selectAsset', () => {
  it('prefers the llama.cpp asset matching the detected cuda version', () => {
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
    expect(result?.target).toBe('linux-x64-cuda');
    expect(result?.asset.name).toBe('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz');
  });

  it('follows future cuda versions automatically', () => {
    const result = selectAsset(
      [
        asset('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz'),
        asset('llama-b1-bin-ubuntu-cuda-13.1-x64.tar.gz'),
      ],
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda'],
      { ...context, cuda: '13.1' },
    );
    expect(result?.asset.name).toBe('llama-b1-bin-ubuntu-cuda-13.1-x64.tar.gz');
  });

  it('falls back to the nearest major cuda version', () => {
    const result = selectAsset(
      [
        asset('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz'),
        asset('llama-b1-bin-ubuntu-cuda-13.1-x64.tar.gz'),
      ],
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda'],
      { ...context, cuda: '13.0' },
    );
    expect(result?.asset.name).toBe('llama-b1-bin-ubuntu-cuda-13.1-x64.tar.gz');
  });

  it('falls back to the cpu build when gpu builds are missing', () => {
    const result = selectAsset(
      [asset('llama-b1-bin-ubuntu-x64.tar.gz')],
      manifest.backends['llama-cpp'].selection,
      ['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu'],
      context,
    );
    expect(result?.target).toBe('linux-x64-cpu');
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
    expect(result?.asset.name).toBe('ik_llama-main-x-bin-ubuntu-x64-avx512.zip');
  });

  it('pairs the windows cuda runtime with the main asset', () => {
    const result = selectAsset(
      [
        asset('cudart-llama-bin-win-cuda-12.4-x64.zip'),
        asset('llama-b1-bin-win-cuda-12.4-x64.zip'),
      ],
      manifest.backends['llama-cpp'].selection,
      ['win-x64-cuda'],
      { ...context, os: 'win' },
    );
    expect(result?.asset.name).toBe('llama-b1-bin-win-cuda-12.4-x64.zip');
    expect(result?.runtime?.name).toBe('cudart-llama-bin-win-cuda-12.4-x64.zip');
  });

  it('pairs the cuda 13 runtime without hardcoded versions', () => {
    const result = selectAsset(
      [
        asset('cudart-llama-bin-win-cuda-13.1-x64.zip'),
        asset('llama-b1-bin-win-cuda-13.1-x64.zip'),
      ],
      manifest.backends['llama-cpp'].selection,
      ['win-x64-cuda'],
      { ...context, os: 'win', cuda: '13.1' },
    );
    expect(result?.asset.name).toBe('llama-b1-bin-win-cuda-13.1-x64.zip');
    expect(result?.runtime?.name).toBe('cudart-llama-bin-win-cuda-13.1-x64.zip');
  });

  it('pairs ik_llama cudart variants with the matching cpu build', () => {
    const main = 'ik_llama-main-b4608-a49a5d7-bin-ubuntu-cuda-12.8-x64-avx2.zip';
    const cudart = 'ik_llama-cudart-main-b4608-a49a5d7-bin-ubuntu-cuda-12.8-x64-avx2.zip';
    const result = selectAsset(
      [asset(cudart), asset(main)],
      manifest.backends['ik-llama-cpp'].selection,
      ['linux-x64-cuda'],
      context,
    );
    expect(result?.asset.name).toBe(main);
    expect(result?.runtime?.name).toBe(cudart);
  });

  it('does not pick the legacy ik_llama cudart bundle as the main asset', () => {
    const main = 'ik_llama-main-b4471-4c5c685-bin-win-cuda-12.8-x64-avx2.zip';
    const legacy = 'ik_llama-main-b4471-4c5c685-cudart-llama-bin-win-cuda-12.8-x64-avx2.zip';
    const result = selectAsset(
      [asset(legacy), asset(main)],
      manifest.backends['ik-llama-cpp'].selection,
      ['win-x64-cuda'],
      { ...context, os: 'win' },
    );
    expect(result?.asset.name).toBe(main);
    expect(result?.runtime?.name).toBe(legacy);
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
    expect(result?.asset.name).toBe('llama-b1-bin-ubuntu-cuda-12.8-x64.tar.gz');
  });
});

describe('candidateTargets', () => {
  it('puts cuda first for a linux nvidia machine', () => {
    expect(candidateTargets({ os: 'linux', arch: 'x64', gpu: { vendor: 'nvidia', name: null, cuda: null } })).toEqual([
      'linux-x64-cuda',
      'linux-x64-vulkan',
      'linux-x64-cpu',
    ]);
  });

  it('uses metal on apple silicon', () => {
    expect(candidateTargets({ os: 'darwin', arch: 'arm64', gpu: { vendor: 'apple', name: null, cuda: null } })).toEqual([
      'darwin-arm64-metal',
      'darwin-x64-cpu',
    ]);
  });

  it('uses cpu when no gpu is present', () => {
    expect(candidateTargets({ os: 'linux', arch: 'x64', gpu: { vendor: 'none', name: null, cuda: null } })).toEqual([
      'linux-x64-cpu',
    ]);
  });
});

describe('variantTargets', () => {
  const nvidia = {
    os: 'linux',
    arch: 'x64',
    cpu: 'avx2',
    gpu: { vendor: 'nvidia', name: null, cuda: '12.8' },
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
    expect(variantTargets('vulkan', { ...nvidia, arch: 'arm64', targets: [] })).toEqual([]);
  });
});

describe('recommendBackend', () => {
  it('picks ik_llama.cpp for cpu-only x86', () => {
    expect(
      recommendBackend(
        { os: 'linux', arch: 'x64', cpu: 'avx2', gpu: { vendor: 'none', name: null, cuda: null }, targets: [] },
        manifest.defaults,
      ),
    ).toBe('ik-llama-cpp');
  });

  it('picks llama.cpp when a discrete gpu is present', () => {
    expect(
      recommendBackend(
        { os: 'linux', arch: 'x64', cpu: 'avx2', gpu: { vendor: 'nvidia', name: null, cuda: null }, targets: [] },
        manifest.defaults,
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

  it('does not expose removed settings', () => {
    expect(manifest.settings['smart-expert-reduction']).toBeUndefined();
  });

  it('maps draft categories to speculative types per backend', () => {
    expect(manifest.backends['llama-cpp'].categorySpecTypes?.eagle3).toBe('draft-eagle3');
    expect(manifest.backends['llama-cpp'].categorySpecTypes?.lilicorr).toBe('draft-lilicorr');
    expect(manifest.backends['llama-cpp'].categorySpecTypes?.dflash2).toBe('draft-dflash2');
    expect(manifest.backends['ik-llama-cpp'].categorySpecTypes?.mtp).toBe('mtp');
    expect(manifest.backends['ik-llama-cpp'].categorySpecTypes?.eagle3).toBeUndefined();
  });
});
