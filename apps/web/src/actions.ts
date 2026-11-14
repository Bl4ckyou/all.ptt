import type { GgufModelInfo } from '@ptt/core';
import type {
  LocalModelInfo,
  ModelConfigInfo,
  ResolvedSettingInfo,
  SettingValue,
} from './types.js';

export interface Actions {
  send(text: string): void;
  stop(): void;
  refreshModels(): Promise<void>;
  setLocale(locale: string): Promise<void>;
  setProvider(id: string): void;
  setModel(id: string): void;
  setView(view: 'chat' | 'manage'): void;
  refreshBackends(): Promise<void>;
  installBackend(id: string, variant: string): Promise<void>;
  updateBackends(): Promise<void>;
  scanModels(): Promise<void>;
  revealPath(target: string): Promise<void>;
  getBackendSettings(backendId: string): Promise<ResolvedSettingInfo[]>;
  getModelConfig(path: string): Promise<ModelConfigInfo | null>;
  getModelInfo(path: string): Promise<GgufModelInfo | null>;
  saveModelConfig(
    path: string,
    settings: Record<string, SettingValue>,
    extraArgs: string,
  ): Promise<void>;
  launchModel(model: LocalModelInfo, backendId: string): Promise<void>;
  stopBackend(providerId: string): Promise<void>;
}
