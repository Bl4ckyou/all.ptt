export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  stop?: string[];
  chatTemplateKwargs?: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  label?: string;
}

export type ChatEvent =
  | { type: 'content'; delta: string }
  | { type: 'done'; usage?: Usage };
