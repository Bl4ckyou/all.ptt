import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { flowerSvg } from '../flower.js';
import { t } from '../i18n.js';
import { icon, type IconName } from '../icons.js';
import { state } from '../state.js';

function languageLabel(locale: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale.toUpperCase();
  }
}

function field(label: string, control: HTMLElement, iconName: IconName): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [icon(iconName), label]),
    control,
  ]);
}

export interface Sidebar {
  element: HTMLElement;
  update(): void;
}

export function createSidebar(actions: Actions): Sidebar {
  const element = el('aside', { class: 'sidebar' });
  const body = el('div', { class: 'sidebar-body' });
  element.append(body);

  function miniButton(
    iconName: IconName,
    label: string,
    onClick: () => void,
    disabled = false,
  ): HTMLButtonElement {
    return el(
      'button',
      {
        class: 'icon-button',
        attrs: {
          title: label,
          'aria-label': label,
          ...(disabled ? { disabled: '' } : {}),
        },
        on: { click: onClick },
      },
      [icon(iconName)],
    );
  }

  function update(): void {
    const projectSelect = el(
      'select',
      {
        class: 'control',
        on: {
          change: (event) => {
            const id = (event.target as HTMLSelectElement).value;
            if (id) void actions.selectProject(id);
          },
        },
      },
      state.projects.length > 0
        ? state.projects.map((project) =>
            option(project.id, project.name, project.id === state.projectId),
          )
        : [option('', t('no-projects'), true)],
    );

    const projectRow = el('div', { class: 'inline-control' }, [
      projectSelect,
      miniButton('plus', t('project-new'), () => {
        const name = window.prompt(t('project-new-prompt'));
        if (name) void actions.createProject(name);
      }),
    ]);

    const conversationSelect = el(
      'select',
      {
        class: 'control',
        attrs: state.projectId ? {} : { disabled: '' },
        on: {
          change: (event) => {
            const id = (event.target as HTMLSelectElement).value;
            if (id) void actions.selectConversation(id);
          },
        },
      },
      state.conversations.length > 0
        ? state.conversations.map((conversation) =>
            option(
              conversation.id,
              conversation.title || t('conversation-untitled'),
              conversation.id === state.conversationId,
            ),
          )
        : [option('', t('conversation-untitled'), true)],
    );

    const conversationRow = el('div', { class: 'inline-control' }, [
      conversationSelect,
      miniButton(
        'plus',
        t('conversation-new'),
        () => void actions.createConversation(),
        !state.projectId,
      ),
    ]);

    const providerSelect = el(
      'select',
      { class: 'control', on: { change: (event) => actions.setProvider((event.target as HTMLSelectElement).value) } },
      state.providers.map((provider) => option(provider.id, provider.id, provider.id === state.providerId)),
    );

    const providerModels = state.models.filter(
      (model) => !state.providerId || model.provider === state.providerId,
    );
    const modelSelect = el(
      'select',
      { class: 'control', on: { change: (event) => actions.setModel((event.target as HTMLSelectElement).value) } },
      providerModels.length > 0
        ? providerModels.map((model) => option(model.id, model.label ?? model.id, model.id === state.model))
        : [option('', t('models-empty'), true)],
    );

    const localeSelect = el(
      'select',
      { class: 'control', on: { change: (event) => void actions.setLocale((event.target as HTMLSelectElement).value) } },
      state.locales.map((locale) =>
        option(locale, languageLabel(locale, state.locale), locale === state.locale),
      ),
    );

    body.replaceChildren(
      el('div', { class: 'brand' }, [
        el('span', { class: 'brand-title' }, [
          flowerSvg('brand-flower', '23 23 164 164'),
          t('app-title'),
        ]),
        el('span', { class: 'brand-tagline', text: t('app-tagline') }),
      ]),
      el('nav', { class: 'nav' }, [
        el('button', {
          class: `nav-button${state.view === 'chat' ? ' active' : ''}`,
          on: { click: () => actions.setView('chat') },
        }, [icon('chat'), t('nav-chat')]),
        el('button', {
          class: `nav-button${state.view === 'manage' ? ' active' : ''}`,
          on: { click: () => actions.setView('manage') },
        }, [icon('manage'), t('nav-manage')]),
      ]),
      ...(state.view === 'chat'
        ? [
            field(t('project-label'), projectRow, 'folder'),
            field(t('conversation-label'), conversationRow, 'chat'),
            state.projectId
              ? el('button', {
                  class: 'refresh',
                  on: { click: () => actions.openNotes() },
                }, [icon('fileText'), t('project-context-title')])
              : el('span', { class: 'error' }),
            field(t('provider-label'), providerSelect, 'server'),
            field(t('model-label'), modelSelect, 'model'),
            el('button', {
              class: 'refresh',
              on: { click: () => void actions.refreshModels() },
            }, [icon('refresh'), t('models-refresh')]),
          ]
        : []),
      field(t('language-label'), localeSelect, 'globe'),
      state.error ? el('p', { class: 'error' }, [icon('x'), t(state.error)]) : el('span', { class: 'error' }),
    );
  }

  return { element, update };
}
