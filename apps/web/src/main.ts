import { detectLocale } from '@ptt/i18n';
import type { Actions } from './actions.js';
import { getLocales, getModels, getProviders, streamChat } from './api.js';
import { el } from './dom.js';
import { loadI18n, readStoredLocale, storeLocale } from './i18n.js';
import { notify, state, subscribe } from './state.js';
import { createChat } from './views/chat.js';
import { createSidebar } from './views/sidebar.js';

let activeRequest: AbortController | null = null;

async function refreshModels(): Promise<void> {
  try {
    const { models, errors } = await getModels();
    state.models = models;
    state.error = errors.length > 0 && models.length === 0 ? 'error-provider' : null;

    const stillValid = models.some(
      (model) => model.id === state.model && model.provider === state.providerId,
    );
    if (!stillValid) {
      const first = models.find((model) => model.provider === state.providerId) ?? models[0];
      state.providerId = first?.provider ?? state.providerId;
      state.model = first?.id ?? null;
    }
  } catch {
    state.error = 'error-provider';
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

const actions: Actions = { send, stop, refreshModels, setLocale, setProvider, setModel };

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
  root.replaceChildren(el('div', { class: 'layout' }, [sidebar.element, chat.element]));

  subscribe(() => {
    sidebar.update();
    chat.update();
  });

  await refreshModels();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  document.body.textContent = 'PTT failed to start.';
});
