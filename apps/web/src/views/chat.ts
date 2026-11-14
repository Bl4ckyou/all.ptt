import type { Actions } from '../actions.js';
import { el } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

export interface Chat {
  element: HTMLElement;
  update(): void;
}

export function createChat(actions: Actions): Chat {
  const messagesEl = el('div', { class: 'messages' });
  const headModel = el('span', { class: 'chat-head-model' });
  const headProvider = el('span', { class: 'chat-head-provider' });
  const header = el('header', { class: 'chat-head' }, [headModel, headProvider]);
  const input = el('textarea', { class: 'composer-input', attrs: { rows: '3' } });
  const button = el('button', { class: 'composer-send', attrs: { type: 'submit' } });
  const form = el('form', { class: 'composer' }, [input, button]);
  const element = el('main', { class: 'chat' }, [header, messagesEl, form]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.streaming) {
      actions.stop();
      return;
    }

    const text = input.value.trim();
    if (text.length === 0) return;
    input.value = '';
    actions.send(text);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  function renderMessages(): void {
    if (state.messages.length === 0) {
      messagesEl.replaceChildren(
        el('p', { class: 'empty' }, [icon('sparkles'), t('chat-empty')]),
      );
      return;
    }

    const bubbles = state.messages.map((message) => {
      const thinking = message.role === 'assistant' && message.content === '' && state.streaming;
      return el('article', { class: `msg msg-${message.role}` }, [
        el('span', { class: 'msg-role' }, [
          message.role === 'assistant' ? icon('sparkles', 'icon small') : icon('chat', 'icon small'),
          message.role,
        ]),
        el('span', { class: 'msg-body', text: thinking ? t('chat-thinking') : message.content }),
      ]);
    });

    messagesEl.replaceChildren(...bubbles);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function update(): void {
    const selected = state.models.find((model) => model.id === state.model) ?? null;
    headModel.textContent = selected?.label ?? state.model ?? t('chat-model-none');
    headProvider.textContent = selected?.provider ?? state.providerId ?? '';

    input.placeholder = t('chat-placeholder');
    const streaming = state.streaming;
    button.replaceChildren(
      icon(streaming ? 'stop' : 'send'),
      streaming ? t('chat-stop') : t('chat-send'),
    );
    renderMessages();
  }

  return { element, update };
}
