import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { GpuInfo, ManifestDefaults, Target } from './types.js';

const RUN_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: 2500,
  stdio: ['ignore', 'pipe', 'ignore'] as Array<'ignore' | 'pipe'>,
};

export function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, RUN_OPTIONS).trim();
  } catch {
    return null;
  }
}

function detectCpu(): string | null {
  if (process.arch !== 'x64') return null;

  if (process.platform === 'linux') {
    try {
      const info = readFileSync('/proc/cpuinfo', 'utf8');
      if (/\bavx512f\b/.test(info)) return 'avx512';
      if (/\bavx2\b/.test(info)) return 'avx2';
    } catch {
      // fall through to the safe default
    }
  }

  if (process.platform === 'darwin') {
    const features = run('sysctl', ['-n', 'machdep.cpu.features']) ?? '';
    if (/AVX512F/i.test(features)) return 'avx512';
    if (/AVX2/i.test(features)) return 'avx2';
  }

  return 'avx2';
}

function firstGpuLine(output: string): string | null {
  return (
    output
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => /vga|3d controller|display|geforce|radeon|arc/i.test(entry)) ??
    output.split('\n')[0]?.trim() ??
    null
  );
}

function detectGpu(): GpuInfo {
  if (process.platform === 'darwin') {
    return { vendor: 'apple', name: 'Apple GPU', cuda: null };
  }

  const nvidia = run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
  if (nvidia) {
    const cuda = /CUDA Version:\s*([\d.]+)/.exec(run('nvidia-smi', []) ?? '')?.[1] ?? null;
    return { vendor: 'nvidia', name: nvidia.split('\n')[0] ?? null, cuda };
  }

  const rocmInfo = run('rocminfo', []);
  if (rocmInfo && /advanced micro devices|amd/i.test(rocmInfo)) {
    return { vendor: 'amd', name: 'AMD GPU', cuda: null };
  }

  const rocmSmi = run('rocm-smi', ['--showproductname']);
  if (rocmSmi && /gpu|amd/i.test(rocmSmi)) {
    return { vendor: 'amd', name: 'AMD GPU', cuda: null };
  }

  const listing = process.platform === 'win32'
    ? run('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name',
      ])
    : run('lspci', []);

  if (listing) {
    if (/nvidia/i.test(listing)) return { vendor: 'nvidia', name: firstGpuLine(listing), cuda: null };
    if (/advanced micro devices|\bamd\b|radeon/i.test(listing)) {
      return { vendor: 'amd', name: firstGpuLine(listing), cuda: null };
    }
    if (/intel/i.test(listing)) return { vendor: 'intel', name: firstGpuLine(listing), cuda: null };
    if (/vga|3d controller|display/i.test(listing)) {
      return { vendor: 'unknown', name: firstGpuLine(listing), cuda: null };
    }
  }

  return { vendor: 'none', name: null, cuda: null };
}

export function candidateTargets({ os, arch, gpu }: Pick<Target, 'os' | 'arch' | 'gpu'>): string[] {
  if (os === 'darwin') {
    return arch === 'arm64' ? ['darwin-arm64-metal', 'darwin-x64-cpu'] : ['darwin-x64-cpu'];
  }

  if (os === 'linux') {
    if (arch === 'arm64') return ['linux-arm64-cpu'];
    if (arch !== 'x64') return [];
    if (gpu.vendor === 'nvidia') return ['linux-x64-cuda', 'linux-x64-vulkan', 'linux-x64-cpu'];
    if (gpu.vendor === 'amd') return ['linux-x64-rocm', 'linux-x64-vulkan', 'linux-x64-cpu'];
    if (gpu.vendor === 'intel' || gpu.vendor === 'unknown') {
      return ['linux-x64-vulkan', 'linux-x64-cpu'];
    }
    return ['linux-x64-cpu'];
  }

  if (os === 'win32') {
    if (arch === 'arm64') return ['win-arm64-cpu'];
    if (arch !== 'x64') return [];
    if (gpu.vendor === 'nvidia') return ['win-x64-cuda', 'win-x64-vulkan', 'win-x64-cpu'];
    if (gpu.vendor === 'amd') return ['win-x64-vulkan', 'win-x64-rocm', 'win-x64-cpu'];
    if (gpu.vendor === 'intel' || gpu.vendor === 'unknown') {
      return ['win-x64-vulkan', 'win-x64-cpu'];
    }
    return ['win-x64-cpu'];
  }

  return [];
}

export function detectTarget(): Target {
  const os = process.platform;
  const arch = process.arch;
  const cpu = detectCpu();
  const gpu = detectGpu();
  return { os, arch, cpu, gpu, targets: candidateTargets({ os, arch, gpu }) };
}

function osPrefix(os: string): string {
  if (os === 'win32') return 'win';
  if (os === 'darwin') return 'darwin';
  return 'linux';
}

// Turn a user-facing variant into ordered candidate target keys.
export function variantTargets(variant: string, target: Target): string[] {
  const { os, arch } = target;
  const prefix = osPrefix(os);

  if (variant === 'auto') {
    const withoutCuda = target.targets.filter((key) => !key.endsWith('-cuda'));
    return withoutCuda.length > 0 ? withoutCuda : target.targets;
  }

  if (variant === 'metal') {
    return os === 'darwin' && arch === 'arm64' ? ['darwin-arm64-metal'] : [];
  }

  if (variant === 'cpu') {
    if (arch === 'arm64') {
      return os === 'darwin' ? ['darwin-arm64-metal'] : [`${prefix}-arm64-cpu`];
    }
    return arch === 'x64' ? [`${prefix}-x64-cpu`] : [];
  }

  if (variant === 'vulkan' || variant === 'cuda' || variant === 'rocm') {
    return arch === 'x64' ? [`${prefix}-x64-${variant}`] : [];
  }

  return [];
}

// Pick a default backend from the hardware profile (policy lives in backends.json).
export function recommendBackend(target: Target, defaults: ManifestDefaults): string {
  const cpuOnly = defaults.cpuOnlyVendors.includes(target.gpu.vendor);
  if (cpuOnly && target.arch === 'x64' && target.cpu) return defaults.cpuOnly;
  return defaults.gpu;
}
