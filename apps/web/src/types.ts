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
  shortLabel: string;
  repo: string;
  defaultVariant: string;
  variants: string[];
  installed: InstalledBackendInfo[];
  kind?: 'github' | 'local';
  custom?: boolean;
}

export interface ReleaseSummary {
  tag: string;
  assets: { name: string; size: number }[];
}

export interface LocalBackendInput {
  id: string;
  label: string;
  path: string;
  modelArg?: string;
  health?: string;
}

export interface GithubBackendInput {
  id: string;
  label: string;
  repo: string;
  tag: string;
  asset: string;
  binaryName?: string;
}

export interface RunningBackendInfo {
  providerId: string;
  backendId: string;
  port: number;
  modelPath: string;
  startedAt: string;
}

export interface BackendLatestInfo {
  latest: Record<string, Record<string, string>>;
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
  quantization?: string | null;
  hasMtp?: boolean;
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
  descriptionKey?: string;
  label?: string;
  description?: string;
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

export interface JobProgressInfo {
  backendId: string;
  label: string;
  phase: string;
  asset: string | null;
  downloaded: number;
  total: number;
}

export interface JobInfo {
  id: string;
  kind: 'install' | 'update';
  status: 'running' | 'paused' | 'done' | 'error' | 'cancelled';
  progress: JobProgressInfo;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}
