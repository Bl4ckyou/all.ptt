import { detectLocale } from '@ptt/i18n';
import type { GgufModelInfo } from '@ptt/core';
import type { Actions } from './actions.js';
import {
  getBackendLatest,
  getBackendSettings,
  getBackends,
  getLocales,
  getLocalModels,
  getModelConfig,
  getModelInfo,
  getModels,
  getProviders,
  getProject,
  getProjects,
  getConversation,
  appendMessage,
  createConversation,
  createProject,
  getJob,
  cancelJob as cancelJobRequest,
  launchBackend,
  pauseJob as pauseJobRequest,
  resumeJob as resumeJobRequest,
  restartProject as restartProjectRequest,
  revealPath as revealPathRequest,
  saveModelConfig,
  saveProjectNotes,
  startInstall,
  startUpdate,
  stopBackend,
  streamChat,
  updateProject as updateProjectRequest,
} from './api.js';
import { el } from './dom.js';
import { createLeafLayer } from './flower.js';
import { loadI18n, readStoredLocale, storeLocale } from './i18n.js';
import { notify, state, subscribe } from './state.js';
import type {
  BackendSettingsInfo,
  JobInfo,
  LocalModelInfo,
  ModelConfigInfo,
  SettingValue,
} from './types.js';
import { createChat } from './views/chat.js';
import { createJobBar } from './views/job-bar.js';
import { createManage } from './views/manage.js';
import { openNotesModal } from './views/notes-modal.js';
import { createSidebar } from './views/sidebar.js';

let activeRequest: AbortController | null = null;
let jobTimer: number | null = null;

async function refreshModels(): Promise<void> {
  try {
    const { models } = await getModels();
    state.models = models;

    const stillValid = models.some(
      (model) => model.id === state.model && model.provider === state.providerId,
    );
    if (!stillValid) {
      const first = models.find((model) => model.provider === state.providerId) ?? models[0];
      state.providerId = first?.provider ?? state.providerId;
      state.model = first?.id ?? null;
    }
  } catch {
    // no provider reachable yet; the user can launch one from Manage
  }
  notify();
}

async function refreshBackends(): Promise<void> {
  try {
    const info = await getBackends();
    state.hardware = info.target;
    state.recommended = info.recommended;
    state.backends = info.backends;
    state.running = info.running;
  } catch {
    // backend panel is optional; keep the UI usable
  }
  notify();
  void checkBackendUpdates();
}

let checkingUpdates = false;

async function checkBackendUpdates(): Promise<void> {
  if (checkingUpdates) return;
  checkingUpdates = true;
  try {
    const { latest } = await getBackendLatest();
    state.backendLatest = latest;
  } catch {
    // update check is informative only
  } finally {
    checkingUpdates = false;
    notify();
  }
}

async function setLocale(locale: string): Promise<void> {
  state.locale = locale;
  storeLocale(locale);
  await loadI18n(locale, state.defaultLocale);
  notify();
}

function setProvider(id: string): void {
  state.providerId = id;
  const first = state.models.find((model) => model.provider === id);
  state.model = first?.id ?? null;
  notify();
}

function setModel(id: string): void {
  state.model = id;
  notify();
}

function setView(view: 'chat' | 'manage'): void {
  state.view = view;
  if (view === 'manage' && (state.error === 'error-provider' || state.error === 'error-no-model')) {
    state.error = null;
  }
  notify();
}

function stopJobPolling(): void {
  if (jobTimer !== null) {
    window.clearInterval(jobTimer);
    jobTimer = null;
  }
}

function watchJob(job: JobInfo): void {
  stopJobPolling();
  state.job = job;
  notify();

  const tick = async (): Promise<void> => {
    let current: JobInfo;
    try {
      current = await getJob(job.id);
    } catch {
      return;
    }

    state.job = current;
    notify();

    if (
      current.status === 'done' ||
      current.status === 'error' ||
      current.status === 'cancelled'
    ) {
      stopJobPolling();
      await refreshBackends();
      const finishedId = current.id;
      setTimeout(() => {
        if (state.job?.id === finishedId) {
          state.job = null;
          notify();
        }
      }, 4000);
    }
  };

  jobTimer = window.setInterval(() => void tick(), 500);
  void tick();
}

function jobActive(): boolean {
  return !!state.job && (state.job.status === 'running' || state.job.status === 'paused');
}

async function installBackendAction(id: string, variant: string): Promise<void> {
  if (jobActive()) return;
  state.error = null;
  notify();
  try {
    const job = await startInstall(id, variant);
    watchJob(job);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function updateBackendsAction(): Promise<void> {
  if (jobActive()) return;
  state.error = null;
  notify();
  try {
    const job = await startUpdate();
    watchJob(job);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function pauseJobAction(): Promise<void> {
  if (!state.job) return;
  try {
    state.job = await pauseJobRequest(state.job.id);
    notify();
  } catch {
    // keep the current state
  }
}

async function resumeJobAction(): Promise<void> {
  if (!state.job) return;
  try {
    state.job = await resumeJobRequest(state.job.id);
    notify();
  } catch {
    // keep the current state
  }
}

async function cancelJobAction(): Promise<void> {
  if (!state.job) return;
  try {
    state.job = await cancelJobRequest(state.job.id);
    notify();
  } catch {
    // keep the current state
  }
}

async function updateProjectAction(): Promise<void> {
  state.busy = 'status-updating';
  state.error = null;
  state.updateReady = false;
  notify();

  try {
    await updateProjectRequest();
    state.updateReady = true;
  } catch {
    state.error = 'error-update';
  }

  state.busy = null;
  notify();
}

async function restartProjectAction(): Promise<void> {
  try {
    await restartProjectRequest();
    setTimeout(() => window.location.reload(), 1500);
  } catch {
    state.error = 'error-update';
    notify();
  }
}

async function scanModels(): Promise<void> {
  state.busy = 'status-scanning';
  notify();
  try {
    const scan = await getLocalModels();
    state.localModels = scan.models;
    state.drafts = scan.drafts;
    state.auxiliary = scan.auxiliary;
    state.modelDirs = scan.directories;
  } catch {
    state.error = 'error-backend';
  }
  state.busy = null;
  notify();
}

async function revealPathAction(target: string): Promise<void> {
  try {
    await revealPathRequest(target);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function getBackendSettingsAction(backendId: string): Promise<BackendSettingsInfo> {
  return getBackendSettings(backendId);
}

async function getModelConfigAction(path: string): Promise<ModelConfigInfo | null> {
  return getModelConfig(path);
}

async function getModelInfoAction(path: string): Promise<GgufModelInfo | null> {
  return getModelInfo(path);
}

async function saveModelConfigAction(
  path: string,
  settings: Record<string, SettingValue>,
  extraArgs: string,
): Promise<void> {
  await saveModelConfig(path, settings, extraArgs);
}

async function launchModel(model: LocalModelInfo, backendId: string): Promise<void> {
  state.busy = 'status-launching';
  state.error = null;
  notify();

  try {
    const run = await launchBackend(backendId, model.path);
    const { providers } = await getProviders();
    state.providers = providers;

    const { models } = await getModels();
    state.models = models;
    state.providerId = run.providerId;
    state.model = models.find((entry) => entry.provider === run.providerId)?.id ?? null;
    state.view = 'chat';
  } catch {
    state.error = 'error-launch';
  }

  state.busy = null;
  await refreshBackends();
}

async function stopBackendAction(providerId: string): Promise<void> {
  try {
    await stopBackend(providerId);
    const { providers } = await getProviders();
    state.providers = providers;

    const { models } = await getModels();
    state.models = models;

    if (state.providerId === providerId) {
      const first = models[0];
      state.providerId = first?.provider ?? providers[0]?.id ?? null;
      state.model = first?.id ?? null;
    }
  } catch {
    state.error = 'error-backend';
  }
  await refreshBackends();
}

function stop(): void {
  activeRequest?.abort();
  activeRequest = null;
}

async function refreshProjects(): Promise<void> {
  try {
    state.projects = await getProjects();
  } catch {
    state.projects = [];
  }

  if (state.projectId && !state.projects.some((project) => project.id === state.projectId)) {
    state.projectId = null;
    state.projectNotes = '';
    state.conversations = [];
    state.conversationId = null;
  }
  notify();
}

async function selectConversationInternal(
  projectId: string,
  conversationId: string,
): Promise<void> {
  const data = await getConversation(projectId, conversationId);
  state.conversationId = conversationId;
  state.messages = data.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  localStorage.setItem(`ptt.conversation.${projectId}`, conversationId);
  notify();
}

async function selectProject(id: string): Promise<void> {
  stop();
  state.streaming = false;
  state.projectId = id;
  state.error = null;
  localStorage.setItem('ptt.project', id);

  try {
    const detail = await getProject(id);
    state.projectNotes = detail.notes;
    state.conversations = detail.conversations;

    const stored = localStorage.getItem(`ptt.conversation.${id}`);
    const conversation =
      detail.conversations.find((entry) => entry.id === stored) ?? detail.conversations[0];

    if (conversation) {
      await selectConversationInternal(id, conversation.id);
    } else {
      state.conversationId = null;
      state.messages = [];
    }
  } catch {
    state.error = 'error-backend';
  }
  notify();
}

async function createProjectAction(name: string): Promise<void> {
  try {
    const project = await createProject(name);
    await refreshProjects();
    await selectProject(project.id);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function createConversationAction(): Promise<void> {
  if (!state.projectId) return;
  try {
    const conversation = await createConversation(state.projectId);
    state.conversations = [conversation, ...state.conversations];
    await selectConversationInternal(state.projectId, conversation.id);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function selectConversationAction(id: string): Promise<void> {
  if (!state.projectId) return;
  stop();
  state.streaming = false;
  try {
    await selectConversationInternal(state.projectId, id);
  } catch {
    state.error = 'error-backend';
    notify();
  }
}

async function saveNotesAction(content: string): Promise<void> {
  if (!state.projectId) return;
  try {
    await saveProjectNotes(state.projectId, content);
    state.projectNotes = content;
  } catch {
    state.error = 'error-backend';
  }
  notify();
}

function openNotesAction(): void {
  if (!state.projectId) return;
  openNotesModal(state.projectNotes, saveNotesAction);
}

async function send(text: string): Promise<void> {
  if (!state.providerId || !state.model) {
    state.error = 'error-no-model';
    notify();
    return;
  }

  const projectId = state.projectId;
  let conversationId = state.conversationId;

  if (projectId) {
    if (!conversationId) {
      try {
        const conversation = await createConversation(projectId);
        state.conversations = [conversation, ...state.conversations];
        state.conversationId = conversation.id;
        localStorage.setItem(`ptt.conversation.${projectId}`, conversation.id);
        conversationId = conversation.id;
      } catch {
        // continue without persistence
      }
    }

    if (conversationId) {
      void appendMessage(projectId, conversationId, 'user', text)
        .then((meta) => {
          state.conversations = state.conversations.map((entry) =>
            entry.id === meta.id ? meta : entry,
          );
          notify();
        })
        .catch(() => undefined);
    }
  }

  state.messages.push({ role: 'user', content: text });
  const assistantIndex = state.messages.push({ role: 'assistant', content: '' }) - 1;
  state.streaming = true;
  state.error = null;
  notify();

  const context =
    projectId && state.projectNotes.trim()
      ? [{ role: 'system' as const, content: state.projectNotes }]
      : [];
  const history = [
    ...context,
    ...state.messages
      .slice(0, assistantIndex)
      .map((message) => ({ role: message.role, content: message.content })),
  ];

  const controller = new AbortController();
  activeRequest = controller;

  streamChat(
    { providerId: state.providerId, model: state.model, messages: history },
    (event) => {
      if (event.type === 'content') {
        const message = state.messages[assistantIndex];
        if (message) message.content += event.delta;
        notify();
      } else if (event.type === 'error') {
        state.error = 'error-provider';
      }
    },
    controller.signal,
  )
    .catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError') state.error = 'error-provider';
    })
    .finally(() => {
      state.streaming = false;
      if (activeRequest === controller) activeRequest = null;

      const content = state.messages[assistantIndex]?.content ?? '';
      if (projectId && conversationId && content.trim().length > 0) {
        void appendMessage(projectId, conversationId, 'assistant', content)
          .then((meta) => {
            state.conversations = state.conversations.map((entry) =>
              entry.id === meta.id ? meta : entry,
            );
            notify();
          })
          .catch(() => undefined);
      }
      notify();
    });
}

const actions: Actions = {
  send,
  stop,
  refreshModels,
  setLocale,
  setProvider,
  setModel,
  setView,
  refreshBackends,
  installBackend: installBackendAction,
  updateBackends: updateBackendsAction,
  pauseJob: pauseJobAction,
  resumeJob: resumeJobAction,
  cancelJob: cancelJobAction,
  updateProject: updateProjectAction,
  restartProject: restartProjectAction,
  refreshProjects,
  createProject: createProjectAction,
  selectProject,
  createConversation: createConversationAction,
  selectConversation: selectConversationAction,
  saveNotes: saveNotesAction,
  openNotes: openNotesAction,
  scanModels,
  revealPath: revealPathAction,
  getBackendSettings: getBackendSettingsAction,
  getModelConfig: getModelConfigAction,
  getModelInfo: getModelInfoAction,
  saveModelConfig: saveModelConfigAction,
  launchModel,
  stopBackend: stopBackendAction,
};

async function bootstrap(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('missing #app');

  const meta = await getLocales();
  state.locales = [...meta.locales];
  state.defaultLocale = meta.defaultLocale;

  const stored = readStoredLocale();
  state.locale =
    stored && meta.locales.includes(stored)
      ? stored
      : detectLocale(navigator.languages, meta.locales, meta.defaultLocale);
  storeLocale(state.locale);
  await loadI18n(state.locale, state.defaultLocale);

  const { providers } = await getProviders();
  state.providers = providers;
  state.providerId = providers[0]?.id ?? null;

  const sidebar = createSidebar(actions);
  const chat = createChat(actions);
  const manage = createManage(actions);
  const jobBar = createJobBar(actions);

  function syncView(): void {
    chat.element.hidden = state.view !== 'chat';
    manage.element.hidden = state.view !== 'manage';
  }

  const layout = el('div', { class: 'layout' }, [sidebar.element, chat.element, manage.element]);
  root.replaceChildren(createLeafLayer(), el('div', { class: 'shell' }, [jobBar.element, layout]));

  subscribe(() => {
    sidebar.update();
    chat.update();
    manage.update();
    jobBar.update();
    syncView();
  });

  syncView();
  jobBar.update();
  await refreshModels();

  await refreshProjects();
  const storedProject = localStorage.getItem('ptt.project');
  const initialProject =
    state.projects.find((project) => project.id === storedProject) ?? state.projects[0];
  if (initialProject) await selectProject(initialProject.id);

  void refreshBackends();
  void scanModels();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  document.body.textContent = 'all.ptt failed to start.';
});
