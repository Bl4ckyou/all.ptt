import type { ProviderAdapter } from '@ptt/core';
import { createLlamaCppProvider } from './llama-cpp.js';
import { createOllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export interface ProviderConfig {
  id: string;
  kind: string;
  baseUrl: string;
  apiKey?: string;
}

type Factory = (config: ProviderConfig) => ProviderAdapter;

const factories: Record<string, Factory> = {
  'llama-cpp': (config) =>
    createLlamaCppProvider({ id: config.id, baseUrl: config.baseUrl, apiKey: config.apiKey }),
  'ik-llama-cpp': (config) =>
    createLlamaCppProvider({ id: config.id, baseUrl: config.baseUrl, apiKey: config.apiKey }),
  ollama: (config) =>
    createOllamaProvider({ id: config.id, baseUrl: config.baseUrl, apiKey: config.apiKey }),
  'openai-compatible': (config) =>
    new OpenAICompatibleProvider({
      id: config.id,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    }),
};

export function createProvider(config: ProviderConfig): ProviderAdapter {
  const factory = factories[config.kind];
  if (!factory) {
    throw new Error(`unknown provider kind: ${config.kind}`);
  }
  return factory(config);
}

export function createProviders(configs: readonly ProviderConfig[]): ProviderAdapter[] {
  return configs.map(createProvider);
}
