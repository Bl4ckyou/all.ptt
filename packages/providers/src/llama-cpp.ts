import { OpenAICompatibleProvider } from './openai-compatible.js';

export interface LlamaCppOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}

export function createLlamaCppProvider(options: LlamaCppOptions): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: options.id ?? 'llama-cpp',
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
}
