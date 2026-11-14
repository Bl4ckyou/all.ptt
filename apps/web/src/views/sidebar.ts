import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';

function languageLabel(locale: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale.toUpperCase();
  }
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
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

  function update(): void {
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
        el('span', { class: 'brand-title', text: t('app-title') }),
        el('span', { class: 'brand-tagline', text: t('app-tagline') }),
      ]),
      field(t('provider-label'), providerSelect),
      field(t('model-label'), modelSelect),
      field(t('language-label'), localeSelect),
      el('button', {
        class: 'refresh',
        text: t('models-refresh'),
        on: { click: () => void actions.refreshModels() },
      }),
      state.error ? el('p', { class: 'error', text: t(state.error) }) : el('span', { class: 'error' }),
    );
  }

  return { element, update };
}
