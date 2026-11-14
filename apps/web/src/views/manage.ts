import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { t } from '../i18n.js';
import { icon, type IconName } from '../icons.js';
import { state } from '../state.js';
import type { BackendInfo } from '../types.js';

const FAVORITES_KEY = 'ptt.favorites';

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

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

export function createManage(actions: Actions): Manage {
  const element = el('section', { class: 'manage' });
  const variantChoices = new Map<string, string>();
  const favorites = loadFavorites();
  let launchBackend: string | null = null;
  let search = '';

  function button(iconName: IconName, label: string, onClick: () => void, danger = false): HTMLButtonElement {
    return el(
      'button',
      { class: `button${danger ? ' danger' : ''}`, on: { click: onClick } },
      [icon(iconName), label],
    );
  }

  function iconButton(
    iconName: IconName,
    label: string,
    onClick: () => void,
    active = false,
  ): HTMLButtonElement {
    return el(
      'button',
      {
        class: `icon-button${active ? ' active' : ''}`,
        attrs: { title: label, 'aria-label': label },
        on: { click: onClick },
      },
      [icon(iconName)],
    );
  }

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
      el('h3', { class: 'manage-title' }, [icon('cpu', 'icon small'), t('manage-hardware')]),
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

    const action = button(
      installed ? 'refresh' : 'download',
      installed ? t('manage-update') : t('manage-install'),
      () => void actions.installBackend(backend.id, choice),
    );

    const status = installed
      ? el('p', {
          class: 'manage-line muted',
          text: backend.installed.map((entry) => `${entry.variant} · ${entry.tag}`).join(', '),
        })
      : el('p', { class: 'manage-line muted', text: t('manage-not-installed') });

    return el('div', { class: 'backend-card' }, [
      el('div', { class: 'manage-head' }, [
        el('span', { class: 'manage-name' }, [icon('server', 'icon small'), backend.label]),
        el('span', { class: 'manage-line muted', text: backend.repo }),
      ]),
      el('div', { class: 'manage-row' }, [select, action]),
      status,
    ]);
  }

  function modelCard(model: (typeof state.localModels)[number]): HTMLElement {
    const favorite = favorites.has(model.path);

    return el('div', { class: 'model-card' }, [
      el('div', { class: 'model-card-top' }, [
        el('span', { class: 'model-name' }, [icon('model', 'icon small'), model.name]),
        el('div', { class: 'model-actions' }, [
          iconButton(
            favorite ? 'starFilled' : 'star',
            favorite ? t('manage-unfavorite') : t('manage-favorite'),
            () => {
              if (favorite) favorites.delete(model.path);
              else favorites.add(model.path);
              saveFavorites(favorites);
              update();
            },
            favorite,
          ),
          iconButton('folderOpen', t('manage-open-folder'), () => void actions.revealPath(model.path)),
        ]),
      ]),
      el('span', { class: 'manage-line muted', text: formatSize(model.size) }),
      button('play', t('manage-launch'), () => {
        if (launchBackend) void actions.launchModel(model, launchBackend);
      }),
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

    const tools: Node[] = [];
    const openDirectory = state.modelDirs[0];
    if (openDirectory) {
      tools.push(
        iconButton('folderOpen', t('manage-open-folder'), () => void actions.revealPath(openDirectory)),
      );
    }
    tools.push(iconButton('scan', t('manage-scan'), () => void actions.scanModels()));

    const term = search.trim().toLowerCase();
    const visible = state.localModels
      .filter(
        (model) =>
          term.length === 0 ||
          model.name.toLowerCase().includes(term) ||
          model.path.toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          Number(favorites.has(b.path)) - Number(favorites.has(a.path)) ||
          a.name.localeCompare(b.name),
      );

    const searchInput = el('input', {
      class: 'control model-search',
      value: search,
      attrs: { type: 'search', placeholder: t('manage-search') },
      on: {
        input: (event) => {
          search = (event.target as HTMLInputElement).value;
          update();
        },
      },
    });

    const list =
      visible.length === 0
        ? el('p', {
            class: 'manage-line muted',
            text: term.length > 0 ? t('manage-no-results') : t('manage-no-models'),
          })
        : el('div', { class: 'model-scroll' }, [
            el('div', { class: 'model-grid' }, visible.map(modelCard)),
          ]);

    return el('div', { class: 'manage-card' }, [
      el('div', { class: 'manage-head manage-head-row' }, [
        el('h3', { class: 'manage-title' }, [icon('folder', 'icon small'), t('manage-local-models')]),
        el('div', { class: 'model-actions' }, tools),
      ]),
      installed.length === 0
        ? el('p', { class: 'manage-line muted', text: t('manage-not-installed') })
        : el('label', { class: 'field' }, [
            el('span', { class: 'field-label' }, [icon('play', 'icon small'), t('manage-launch-with')]),
            backendSelect,
          ]),
      state.localModels.length > 0
        ? el('label', { class: 'search' }, [
            icon('search', 'icon small'),
            searchInput,
          ])
        : null,
      state.localModels.length > 0
        ? el('p', { class: 'manage-line muted', text: t('manage-model-count', { count: visible.length }) })
        : null,
      list,
    ].filter(Boolean) as Node[]);
  }

  function runningCard(): HTMLElement {
    const rows = state.running.map((run) =>
      el('div', { class: 'model-row' }, [
        el('div', { class: 'model-info' }, [
          el('span', { class: 'model-name' }, [icon('server', 'icon small'), `${run.providerId} · :${run.port}`]),
          el('span', {
            class: 'manage-line muted',
            text: run.modelPath.split(/[/\\]/).pop() ?? run.modelPath,
          }),
        ]),
        button('stop', t('manage-stop'), () => void actions.stopBackend(run.providerId), true),
      ]),
    );

    return el('div', { class: 'manage-card' }, [
      el('h3', { class: 'manage-title' }, [icon('server', 'icon small'), t('manage-running')]),
      rows.length === 0
        ? el('p', { class: 'manage-line muted', text: t('manage-none-running') })
        : el('div', { class: 'model-list' }, rows),
    ]);
  }

  function update(): void {
    const active = document.activeElement;
    const restoring =
      active instanceof HTMLInputElement && active.classList.contains('model-search');
    const caret = restoring ? active.selectionStart : null;

    const nodes: Node[] = [
      el('div', { class: 'manage-top' }, [
        el('h2', { class: 'manage-heading' }, [icon('manage', 'icon heading'), t('nav-manage')]),
        button('refresh', t('manage-update-all'), () => void actions.updateBackends()),
      ]),
    ];

    if (state.busy) nodes.push(el('p', { class: 'manage-busy' }, [icon('sparkles', 'icon small'), t(state.busy)]));
    if (state.error) nodes.push(el('p', { class: 'error' }, [icon('x'), t(state.error)]));

    nodes.push(hardwareCard());
    nodes.push(
      el('div', { class: 'manage-card' }, [
        el('h3', { class: 'manage-title' }, [icon('server', 'icon small'), t('backends-title')]),
        ...state.backends.map(backendCard),
      ]),
    );
    nodes.push(modelsCard());
    nodes.push(runningCard());

    element.replaceChildren(...nodes);

    if (restoring) {
      const input = element.querySelector<HTMLInputElement>('.model-search');
      input?.focus();
      if (caret !== null) input?.setSelectionRange(caret, caret);
    }
  }

  return { element, update };
}
