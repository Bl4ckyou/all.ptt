import type { ChatEvent, ChatRequest, ModelInfo } from './types.js';

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  models: boolean;
}

export interface ProviderAdapter {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest): AsyncIterable<ChatEvent>;
}
