import type { ChatEvent, ChatMessage, ModelInfo } from '@ptt/core';
import type { ProviderSummary } from './state.js';

export interface LocaleMeta {
  defaultLocale: string;
  locales: string[];
}

export async function getLocales(): Promise<LocaleMeta> {
  const response = await fetch('/api/i18n');
  if (!response.ok) throw new Error('failed to load locales');
  return (await response.json()) as LocaleMeta;
}

export async function getCatalog(locale: string): Promise<string> {
  const response = await fetch(`/api/i18n/${locale}`);
  if (!response.ok) throw new Error(`failed to load locale: ${locale}`);
  return response.text();
}

export async function getProviders(): Promise<{ providers: ProviderSummary[] }> {
  const response = await fetch('/api/providers');
  if (!response.ok) throw new Error('failed to load providers');
  return (await response.json()) as { providers: ProviderSummary[] };
}

export async function getModels(): Promise<{ models: ModelInfo[]; errors: string[] }> {
  const response = await fetch('/api/models');
  if (!response.ok) throw new Error('failed to load models');
  return (await response.json()) as { models: ModelInfo[]; errors: string[] };
}

export interface ChatRequestBody {
  providerId: string;
  model: string;
  messages: ChatMessage[];
}

type StreamEvent = ChatEvent | { type: 'error'; code: string };

export async function streamChat(
  body: ChatRequestBody,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error('chat request failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      const line = chunk.split('\n').find((part) => part.startsWith('data:'));
      if (!line) continue;

      try {
        onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
      } catch {
        continue;
      }
    }
  }
}
