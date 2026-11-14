import type { ChatMessage, ModelInfo } from '@ptt/core';
import type {
  BackendInfo,
  HardwareInfo,
  LocalModelInfo,
  ProviderSummary,
  RunningBackendInfo,
} from './types.js';

export interface State {
  view: 'chat' | 'manage';
  locale: string;
  locales: string[];
  defaultLocale: string;
  providers: ProviderSummary[];
  models: ModelInfo[];
  providerId: string | null;
  model: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  busy: string | null;
  hardware: HardwareInfo | null;
  recommended: string | null;
  backends: BackendInfo[];
  localModels: LocalModelInfo[];
  modelDirs: string[];
  running: RunningBackendInfo[];
}

export const state: State = {
  view: 'chat',
  locale: 'en',
  locales: [],
  defaultLocale: 'en',
  providers: [],
  models: [],
  providerId: null,
  model: null,
  messages: [],
  streaming: false,
  error: null,
  busy: null,
  hardware: null,
  recommended: null,
  backends: [],
  localModels: [],
  modelDirs: [],
  running: [],
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): void {
  listeners.add(listener);
}

export function notify(): void {
  for (const listener of listeners) listener();
}
