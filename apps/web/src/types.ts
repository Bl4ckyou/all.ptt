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
  category?:
    | 'assistant'
    | 'dflash'
    | 'dflash2'
    | 'dspark'
    | 'eagle3'
    | 'lilicorr'
    | 'mtp'
    | 'other';
  architecture?: string | null;
  blockCount?: number | null;
  embeddingLength?: number | null;
  contextLength?: number | null;
}

export interface AuxiliaryFile extends LocalModelInfo {
  kind: 'mmproj' | 'mtp';
}

export type SettingValue = string | number | boolean;

export interface ResolvedSettingInfo {
  id: string;
  type: 'number' | 'boolean' | 'string' | 'enum' | 'path';
  category: string;
  default?: SettingValue;
  min?: number;
  max?: number;
  choices?: string[];
  descriptionKey: string;
  advanced?: boolean;
  platforms?: string[];
  fileKind?: 'model' | 'mmproj' | 'mtp';
  dependsOn?: { setting: string; values?: string[]; includes?: string };
  available: boolean;
}

export interface ModelConfigInfo {
  settings: Record<string, SettingValue>;
  extraArgs: string;
  updatedAt?: string;
}

export interface BackendSettingsInfo {
  settings: ResolvedSettingInfo[];
  categorySpecTypes: Record<string, string>;
  probed: boolean;
}
