import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import type { BackendInfo } from '../types.js';

export interface Manage {
  element: HTMLElement;
  update(): void;
}

function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function variantLabel(variant: string): string {
  return variant === 'auto' ? t('backend-auto') : t(`variant-${variant}`);
}

export function createManage(actions: Actions): Manage {
  const element = el('section', { class: 'manage' });
  const variantChoices = new Map<string, string>();
  let launchBackend: string | null = null;

  function installedBackends(): { id: string; label: string }[] {
    return state.backends
      .filter((backend) => backend.installed.length > 0)
      .map((backend) => ({ id: backend.id, label: backend.label }));
  }

  function hardwareCard(): HTMLElement {
    const hw = state.hardware;
    const parts: string[] = [];
    if (hw) {
      parts.push(`${hw.os}/${hw.arch}`);
      if (hw.cpu) parts.push(hw.cpu.toUpperCase());
      parts.push(hw.gpu.vendor);
    }
    return el('div', { class: 'manage-card' }, [
      el('h3', { class: 'manage-title', text: t('manage-hardware') }),
      el('p', { class: 'manage-line', text: parts.join(' · ') || '—' }),
      el('p', {
        class: 'manage-line muted',
        text: `${t('manage-recommended')}: ${state.recommended ?? '—'}`,
      }),
    ]);
  }

  function backendCard(backend: BackendInfo): HTMLElement {
    const choice = variantChoices.get(backend.id) ?? backend.defaultVariant;
    const installed = backend.installed.length > 0;

    const select = el(
      'select',
      {
        class: 'control',
        on: {
          change: (event) => {
            variantChoices.set(backend.id, (event.target as HTMLSelectElement).value);
          },
        },
      },
      backend.variants.map((variant) => option(variant, variantLabel(variant), variant === choice)),
    );

    const button = el('button', {
      class: 'button',
      text: installed ? t('manage-update') : t('manage-install'),
      on: { click: () => void actions.installBackend(backend.id, choice) },
    });

    const status = installed
      ? el('p', {
          class: 'manage-line muted',
          text: backend.installed.map((entry) => `${entry.variant} · ${entry.tag}`).join(', '),
        })
      : el('p', { class: 'manage-line muted', text: t('manage-not-installed') });

    return el('div', { class: 'backend-card' }, [
      el('div', { class: 'manage-head' }, [
        el('span', { class: 'manage-name', text: backend.label }),
        el('span', { class: 'manage-line muted', text: backend.repo }),
      ]),
      el('div', { class: 'manage-row' }, [select, button]),
      status,
    ]);
  }

  function modelsCard(): HTMLElement {
    const installed = installedBackends();
    if (!launchBackend || !installed.some((backend) => backend.id === launchBackend)) {
      launchBackend = installed[0]?.id ?? null;
    }

    const backendSelect = el(
      'select',
      {
        class: 'control',
        on: {
          change: (event) => {
            launchBackend = (event.target as HTMLSelectElement).value;
          },
        },
      },
      installed.map((backend) => option(backend.id, backend.label, backend.id === launchBackend)),
    );

    const rows = state.localModels.map((model) =>
      el('div', { class: 'model-row' }, [
        el('div', { class: 'model-info' }, [
          el('span', { class: 'model-name', text: model.name }),
          el('span', { class: 'manage-line muted', text: formatSize(model.size) }),
        ]),
        el('button', {
          class: 'button',
          text: t('manage-launch'),
          on: {
            click: () => {
              if (launchBackend) void actions.launchModel(model, launchBackend);
            },
          },
        }),
      ]),
    );

    return el('div', { class: 'manage-card' }, [
      el('div', { class: 'manage-head' }, [
        el('h3', { class: 'manage-title', text: t('manage-local-models') }),
        el('button', {
          class: 'button',
          text: t('manage-scan'),
          on: { click: () => void actions.scanModels() },
        }),
      ]),
      installed.length === 0
        ? el('p', { class: 'manage-line muted', text: t('manage-not-installed') })
        : el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: t('manage-launch-with') }),
            backendSelect,
          ]),
      state.localModels.length === 0
        ? el('p', { class: 'manage-line muted', text: t('manage-no-models') })
        : el('div', { class: 'model-list' }, rows),
    ]);
  }

  function runningCard(): HTMLElement {
    const rows = state.running.map((run) =>
      el('div', { class: 'model-row' }, [
        el('div', { class: 'model-info' }, [
          el('span', { class: 'model-name', text: `${run.providerId} · :${run.port}` }),
          el('span', {
            class: 'manage-line muted',
            text: run.modelPath.split(/[/\\]/).pop() ?? run.modelPath,
          }),
        ]),
        el('button', {
          class: 'button danger',
          text: t('manage-stop'),
          on: { click: () => void actions.stopBackend(run.providerId) },
        }),
      ]),
    );

    return el('div', { class: 'manage-card' }, [
      el('h3', { class: 'manage-title', text: t('manage-running') }),
      rows.length === 0
        ? el('p', { class: 'manage-line muted', text: t('manage-none-running') })
        : el('div', { class: 'model-list' }, rows),
    ]);
  }

  function update(): void {
    const nodes: Node[] = [
      el('div', { class: 'manage-top' }, [
        el('h2', { class: 'manage-heading', text: t('nav-manage') }),
        el('button', {
          class: 'button',
          text: t('manage-update-all'),
          on: { click: () => void actions.updateBackends() },
        }),
      ]),
    ];

    if (state.busy) nodes.push(el('p', { class: 'manage-busy', text: t(state.busy) }));
    if (state.error) nodes.push(el('p', { class: 'error', text: t(state.error) }));

    nodes.push(hardwareCard());
    nodes.push(
      el('div', { class: 'manage-card' }, [
        el('h3', { class: 'manage-title', text: t('backends-title') }),
        ...state.backends.map(backendCard),
      ]),
    );
    nodes.push(modelsCard());
    nodes.push(runningCard());

    element.replaceChildren(...nodes);
  }

  return { element, update };
}
