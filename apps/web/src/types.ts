export interface ProviderSummary {
  id: string;
  capabilities: {
    chat: boolean;
    streaming: boolean;
    models: boolean;
  };
}

export interface GpuInfo {
  vendor: string;
  name: string | null;
  cuda: string | null;
}

export interface HardwareInfo {
  os: string;
  arch: string;
  cpu: string | null;
  gpu: GpuInfo;
  targets: string[];
}

export interface InstalledBackendInfo {
  variant: string;
  target: string;
  tag: string;
  binary: string;
}

export interface BackendInfo {
  id: string;
  label: string;
  repo: string;
  defaultVariant: string;
  variants: string[];
  installed: InstalledBackendInfo[];
}

export interface RunningBackendInfo {
  providerId: string;
  backendId: string;
  port: number;
  modelPath: string;
  startedAt: string;
}

export interface BackendsInfo {
  target: HardwareInfo;
  recommended: string;
  backends: BackendInfo[];
  running: RunningBackendInfo[];
}

export interface LocalModelInfo {
  path: string;
  name: string;
  size: number;
  source: string;
}
