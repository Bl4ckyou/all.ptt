import type { ChatEvent, ChatMessage, ModelInfo } from '@ptt/core';
import type {
  BackendsInfo,
  LocalModelInfo,
  ProviderSummary,
} from './types.js';

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

export async function getBackends(): Promise<BackendsInfo> {
  const response = await fetch('/api/backends');
  if (!response.ok) throw new Error('failed to load backends');
  return (await response.json()) as BackendsInfo;
}

export async function installBackend(id: string, variant: string): Promise<void> {
  const response = await fetch('/api/backends/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, variant }),
  });
  if (!response.ok) throw new Error('backend install failed');
}

export async function updateBackends(): Promise<void> {
  const response = await fetch('/api/backends/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('backend update failed');
}

export async function getLocalModels(): Promise<{ models: LocalModelInfo[]; directories: string[] }> {
  const response = await fetch('/api/models/local');
  if (!response.ok) throw new Error('failed to scan models');
  return (await response.json()) as { models: LocalModelInfo[]; directories: string[] };
}

export async function revealPath(target: string): Promise<void> {
  const response = await fetch('/api/models/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  });
  if (!response.ok) throw new Error('failed to open folder');
}

export interface LaunchResult {
  providerId: string;
  backendId: string;
  port: number;
  modelPath: string;
}

export async function launchBackend(backendId: string, modelPath: string): Promise<LaunchResult> {
  const response = await fetch('/api/backends/launch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backendId, modelPath }),
  });
  if (!response.ok) throw new Error('backend launch failed');
  return (await response.json()) as LaunchResult;
}

export async function stopBackend(providerId: string): Promise<void> {
  const response = await fetch('/api/backends/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId }),
  });
  if (!response.ok) throw new Error('backend stop failed');
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
