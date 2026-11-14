import type { ChatEvent, ChatMessage, ModelInfo } from '@ptt/core';
import type { GgufModelInfo } from '@ptt/core';
import type {
  AuxiliaryFile,
  BackendSettingsInfo,
  BackendsInfo,
  ConversationMeta,
  LocalModelInfo,
  ModelConfigInfo,
  JobInfo,
  ProjectMeta,
  ProviderSummary,
  ResolvedSettingInfo,
  SettingValue,
  StoredMessage,
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

export async function startInstall(id: string, variant: string): Promise<JobInfo> {
  const response = await fetch('/api/backends/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, variant }),
  });
  if (!response.ok) throw new Error('backend install failed');
  return (await response.json()) as JobInfo;
}

export async function startUpdate(): Promise<JobInfo> {
  const response = await fetch('/api/backends/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('backend update failed');
  return (await response.json()) as JobInfo;
}

export async function getJob(id: string): Promise<JobInfo> {
  const response = await fetch(`/api/backends/jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('failed to load job');
  return (await response.json()) as JobInfo;
}

async function jobAction(id: string, action: string): Promise<JobInfo> {
  const response = await fetch(`/api/backends/jobs/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(`failed to ${action} job`);
  return (await response.json()) as JobInfo;
}

export const pauseJob = (id: string): Promise<JobInfo> => jobAction(id, 'pause');
export const resumeJob = (id: string): Promise<JobInfo> => jobAction(id, 'resume');
export const cancelJob = (id: string): Promise<JobInfo> => jobAction(id, 'cancel');

export async function getLocalModels(): Promise<{
  models: LocalModelInfo[];
  drafts: LocalModelInfo[];
  auxiliary: AuxiliaryFile[];
  directories: string[];
}> {
  const response = await fetch('/api/models/local');
  if (!response.ok) throw new Error('failed to scan models');
  return (await response.json()) as {
    models: LocalModelInfo[];
    drafts: LocalModelInfo[];
    auxiliary: AuxiliaryFile[];
    directories: string[];
  };
}

export async function revealPath(target: string): Promise<void> {
  const response = await fetch('/api/models/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  });
  if (!response.ok) throw new Error('failed to open folder');
}

export async function getBackendSettings(backendId: string): Promise<BackendSettingsInfo> {
  const response = await fetch(`/api/backends/settings?backendId=${encodeURIComponent(backendId)}`);
  if (!response.ok) throw new Error('failed to load settings');
  return (await response.json()) as BackendSettingsInfo;
}

export async function getModelConfig(path: string): Promise<ModelConfigInfo | null> {
  const response = await fetch(`/api/models/config?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error('failed to load model config');
  const body = (await response.json()) as { config: ModelConfigInfo | null };
  return body.config;
}

export async function getModelInfo(path: string): Promise<GgufModelInfo | null> {
  const response = await fetch(`/api/models/info?path=${encodeURIComponent(path)}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { info: GgufModelInfo };
  return body.info;
}

export async function saveModelConfig(
  path: string,
  settings: Record<string, SettingValue>,
  extraArgs: string,
): Promise<void> {
  const response = await fetch('/api/models/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, settings, extraArgs }),
  });
  if (!response.ok) throw new Error('failed to save model config');
}

export async function updateProject(): Promise<void> {
  const response = await fetch('/api/system/update', { method: 'POST' });
  if (!response.ok) throw new Error('project update failed');
}

export async function restartProject(): Promise<void> {
  const response = await fetch('/api/system/restart', { method: 'POST' });
  if (!response.ok) throw new Error('project restart failed');
}

export async function getProjects(): Promise<ProjectMeta[]> {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('failed to load projects');
  const body = (await response.json()) as { projects: ProjectMeta[] };
  return body.projects;
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error('failed to create project');
  const body = (await response.json()) as { project: ProjectMeta };
  return body.project;
}

export interface ProjectDetail {
  project: ProjectMeta;
  notes: string;
  conversations: ConversationMeta[];
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('failed to load project');
  return (await response.json()) as ProjectDetail;
}

export async function saveProjectNotes(id: string, content: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error('failed to save notes');
}

export async function createConversation(projectId: string, title = ''): Promise<ConversationMeta> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error('failed to create conversation');
  const body = (await response.json()) as { conversation: ConversationMeta };
  return body.conversation;
}

export async function getConversation(
  projectId: string,
  conversationId: string,
): Promise<{ conversation: ConversationMeta; messages: StoredMessage[] }> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
  );
  if (!response.ok) throw new Error('failed to load conversation');
  return (await response.json()) as { conversation: ConversationMeta; messages: StoredMessage[] };
}

export async function appendMessage(
  projectId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<ConversationMeta> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, content }),
    },
  );
  if (!response.ok) throw new Error('failed to save message');
  const body = (await response.json()) as { conversation: ConversationMeta };
  return body.conversation;
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
