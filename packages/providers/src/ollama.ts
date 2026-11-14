import { OpenAICompatibleProvider } from './openai-compatible.js';

export interface OllamaOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}

// Ollama exposes an OpenAI-compatible endpoint under /v1.
export function createOllamaProvider(options: OllamaOptions): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: options.id ?? 'ollama',
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
}
