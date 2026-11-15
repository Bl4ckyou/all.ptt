import type { GgufModelInfo } from '@ptt/core';
import type {
  BackendSettingsInfo,
  GithubBackendInput,
  LocalBackendInput,
  LocalModelInfo,
  ModelConfigInfo,
  ReleaseSummary,
  TranslationStatus,
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
  addLocalBackend(input: LocalBackendInput): Promise<void>;
  addGithubBackend(input: GithubBackendInput): Promise<void>;
  browseBackendReleases(repo: string): Promise<ReleaseSummary[]>;
  removeBackend(id: string): Promise<void>;
  translationStatus(): Promise<TranslationStatus>;
  downloadTranslation(): Promise<TranslationStatus>;
  enableTranslation(path: string): Promise<TranslationStatus>;
  disableTranslation(): Promise<TranslationStatus>;
  installBackend(id: string, variant: string): Promise<void>;
  updateBackends(): Promise<void>;
  pauseJob(): Promise<void>;
  resumeJob(): Promise<void>;
  cancelJob(): Promise<void>;
  updateProject(): Promise<void>;
  restartProject(): Promise<void>;
  refreshProjects(): Promise<void>;
  createProject(name: string): Promise<void>;
  selectProject(id: string): Promise<void>;
  createConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  saveNotes(content: string): Promise<void>;
  openNotes(): void;
  scanModels(): Promise<void>;
  revealPath(target: string): Promise<void>;
  getBackendSettings(backendId: string, locale?: string): Promise<BackendSettingsInfo>;
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
