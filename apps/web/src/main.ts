import { detectLocale } from '@ptt/i18n';
import type { GgufModelInfo } from '@ptt/core';
import type { Actions } from './actions.js';
import {
  getBackendSettings,
  getBackends,
  getLocales,
  getLocalModels,
  getModelConfig,
  getModelInfo,
  getModels,
  getProviders,
  getJob,
  cancelJob as cancelJobRequest,
  launchBackend,
  pauseJob as pauseJobRequest,
  resumeJob as resumeJobRequest,
  restartProject as restartProjectRequest,
  revealPath as revealPathRequest,
  saveModelConfig,
  startInstall,
  startUpdate,
  stopBackend,
  streamChat,
  updateProject as updateProjectRequest,
} from './api.js';
import { el } from './dom.js';
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

function send(text: string): void {
  if (!state.providerId || !state.model) {
    state.error = 'error-no-model';
    notify();
    return;
  }

  state.messages.push({ role: 'user', content: text });
  const assistantIndex = state.messages.push({ role: 'assistant', content: '' }) - 1;
  state.streaming = true;
  state.error = null;
  notify();

  const history = state.messages
    .slice(0, assistantIndex)
    .map((message) => ({ role: message.role, content: message.content }));

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
  root.replaceChildren(el('div', { class: 'shell' }, [jobBar.element, layout]));

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
  void refreshBackends();
  void scanModels();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  document.body.textContent = 'PTT failed to start.';
});
