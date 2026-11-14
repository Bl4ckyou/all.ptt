export interface GpuInfo {
  vendor: string;
  name: string | null;
  cuda: string | null;
}

export interface Target {
  os: string;
  arch: string;
  cpu: string | null;
  gpu: GpuInfo;
  targets: string[];
}

export interface SelectionRule {
  targets: string[];
  include: string;
  exclude?: string[];
  prefer?: string[];
}

export interface BackendEntry {
  label: string;
  repo: string;
  defaultVariant: string;
  binaries: string[];
  selection: SelectionRule[];
}

export interface ManifestDefaults {
  cpuOnlyVendors: string[];
  cpuOnly: string;
  gpu: string;
}

export interface Manifest {
  defaults: ManifestDefaults;
  backends: Record<string, BackendEntry>;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface InstalledVariant {
  variant: string;
  target: string;
  tag: string;
  asset: string;
  size: number;
  installedAt: string;
  binary: string;
  legacy?: boolean;
}

export interface InstalledState {
  backend: string;
  variants: Record<string, InstalledVariant>;
}

export interface SyncRecord {
  variant: string;
  target: string;
  tag: string;
  asset: string;
  size?: number;
  binary?: string | null;
  installedAt?: string;
  skipped?: boolean;
  dryRun?: boolean;
}

export interface SyncResult {
  id: string;
  skipped?: boolean;
  reason?: string;
  records: SyncRecord[];
  dryRun?: boolean;
}

export const VARIANTS = ['auto', 'cpu', 'vulkan', 'cuda', 'rocm', 'metal'] as const;

export type Variant = (typeof VARIANTS)[number];
