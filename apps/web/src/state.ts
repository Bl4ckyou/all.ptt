import type { ChatMessage, ModelInfo } from '@ptt/core';

export interface ProviderSummary {
  id: string;
  capabilities: {
    chat: boolean;
    streaming: boolean;
    models: boolean;
  };
}

export interface State {
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
}

export const state: State = {
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
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): void {
  listeners.add(listener);
}

export function notify(): void {
  for (const listener of listeners) listener();
}
