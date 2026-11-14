import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { t } from '../i18n.js';
import { icon, type IconName } from '../icons.js';
import { state } from '../state.js';
import type {
  BackendInfo,
  LocalModelInfo,
  ResolvedSettingInfo,
  SettingValue,
} from '../types.js';

const FAVORITES_KEY = 'ptt.favorites';
const SORT_MODES = ['favorites', 'name-asc', 'name-desc', 'size-asc', 'size-desc'] as const;
type SortMode = (typeof SORT_MODES)[number];

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
  let sortMode: SortMode = 'favorites';

  let configModel: LocalModelInfo | null = null;
  let configBackend: string | null = null;
  let configSettings: ResolvedSettingInfo[] = [];
  let configValues: Record<string, SettingValue> = {};
  let configExtra = '';
  let configLoading = false;
  let configSaving = false;
  let configError: string | null = null;

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

  function defaultValues(
    settings: ResolvedSettingInfo[],
    saved: Record<string, SettingValue>,
  ): Record<string, SettingValue> {
    const values: Record<string, SettingValue> = { ...saved };
    for (const setting of settings) {
      if (!(setting.id in values) && setting.default !== undefined) {
        values[setting.id] = setting.default;
      }
    }
    return values;
  }

  async function loadConfigFor(backendId: string, path: string): Promise<void> {
    configLoading = true;
    configError = null;
    update();

    try {
      const [settings, config] = await Promise.all([
        actions.getBackendSettings(backendId),
        actions.getModelConfig(path),
      ]);
      configSettings = settings;
      configValues = defaultValues(settings, config?.settings ?? {});
      configExtra = config?.extraArgs ?? '';
    } catch {
      configError = 'error-config';
    }

    configLoading = false;
    update();
  }

  async function openConfig(model: LocalModelInfo): Promise<void> {
    configModel = model;
    configSettings = [];
    configValues = {};
    configExtra = '';
    configError = null;
    configLoading = true;

    const backendId =
      launchBackend ?? installedBackends()[0]?.id ?? null;
    configBackend = backendId;
    update();

    if (!backendId) {
      configLoading = false;
      configError = 'manage-not-installed';
      update();
      return;
    }

    await loadConfigFor(backendId, model.path);
  }

  async function saveConfig(): Promise<void> {
    if (!configModel || configSaving) return;
    const path = configModel.path;
    configSaving = true;
    update();

    try {
      await actions.saveModelConfig(path, configValues, configExtra);
      configModel = null;
    } catch {
      configError = 'error-config';
    }

    configSaving = false;
    update();
  }

  function settingControl(setting: ResolvedSettingInfo): HTMLElement {
    const current = configValues[setting.id] ?? setting.default;

    if (setting.type === 'boolean') {
      const checkbox = el('input', {
        class: 'toggle',
        attrs: { type: 'checkbox', ...(current === true ? { checked: '' } : {}) },
        on: {
          change: (event) => {
            configValues[setting.id] = (event.target as HTMLInputElement).checked;
          },
        },
      });
      return el('label', { class: 'switch' }, [checkbox, el('span', { class: 'switch-track' })]);
    }

    if (setting.type === 'enum') {
      return el(
        'select',
        {
          class: 'control',
          on: {
            change: (event) => {
              configValues[setting.id] = (event.target as HTMLSelectElement).value;
            },
          },
        },
        (setting.choices ?? []).map((choice) => option(choice, choice, choice === current)),
      );
    }

    const attrs: Record<string, string> = { type: setting.type === 'number' ? 'number' : 'text' };
    if (setting.min !== undefined) attrs.min = String(setting.min);
    if (setting.max !== undefined) attrs.max = String(setting.max);

    return el('input', {
      class: 'control',
      value: current === undefined ? '' : String(current),
      attrs,
      on: {
        input: (event) => {
          const raw = (event.target as HTMLInputElement).value;
          if (raw === '') {
            delete configValues[setting.id];
          } else {
            configValues[setting.id] = setting.type === 'number' ? Number(raw) : raw;
          }
        },
      },
    });
  }

  function settingRow(setting: ResolvedSettingInfo): HTMLElement {
    return el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-info' }, [
        el('span', { class: 'setting-name', text: t(`setting-${setting.id}`) }),
        el('span', { class: 'setting-desc muted', text: t(setting.descriptionKey) }),
      ]),
      settingControl(setting),
    ]);
  }

  function configModal(): HTMLElement | null {
    const model = configModel;
    if (!model) return null;

    const installed = installedBackends();
    const close = (): void => {
      configModel = null;
      update();
    };

    const backendSelect = el(
      'select',
      {
        class: 'control',
        on: {
          change: (event) => {
            const id = (event.target as HTMLSelectElement).value;
            configBackend = id;
            void loadConfigFor(id, model.path);
          },
        },
      },
      installed.map((backend) => option(backend.id, backend.label, backend.id === configBackend)),
    );

    const body: Node[] = [
      el('p', { class: 'manage-line muted', text: model.path }),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, [icon('server', 'icon small'), t('manage-launch-with')]),
        backendSelect,
      ]),
    ];

    if (configLoading) {
      body.push(el('p', { class: 'manage-busy' }, [icon('sparkles', 'icon small'), t('status-loading')]));
    } else if (configError) {
      body.push(el('p', { class: 'error' }, [icon('x'), t(configError)]));
    } else if (configSettings.length === 0) {
      body.push(el('p', { class: 'manage-line muted', text: t('manage-config-none') }));
    } else {
      body.push(el('div', { class: 'setting-list' }, configSettings.map(settingRow)));
    }

    body.push(
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, [icon('manage', 'icon small'), t('manage-config-extra')]),
        el('input', {
          class: 'control',
          value: configExtra,
          attrs: { type: 'text', placeholder: t('manage-config-extra-hint') },
          on: {
            input: (event) => {
              configExtra = (event.target as HTMLInputElement).value;
            },
          },
        }),
      ]),
    );

    const modal = el('div', {
      class: 'modal',
      on: { click: (event) => event.stopPropagation() },
    }, [
      el('div', { class: 'modal-head' }, [
        el('h3', { class: 'manage-title' }, [icon('model', 'icon small'), t('manage-model-config')]),
        iconButton('x', t('manage-config-cancel'), close),
      ]),
      el('p', { class: 'modal-title', text: model.name }),
      ...body,
      el('div', { class: 'modal-foot' }, [
        button('x', t('manage-config-cancel'), close),
        button('check', configSaving ? t('status-loading') : t('manage-config-save'), () => void saveConfig()),
      ]),
    ]);

    return el('div', { class: 'modal-backdrop', on: { click: close } }, [modal]);
  }

  function modelCard(model: LocalModelInfo): HTMLElement {
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
          iconButton('manage', t('manage-model-config'), () => void openConfig(model)),
          iconButton('folderOpen', t('manage-open-folder'), () => void actions.revealPath(model.path)),
        ]),
      ]),
      el('span', { class: 'manage-line muted', text: formatSize(model.size) }),
      button('play', t('manage-launch'), () => {
        if (launchBackend) void actions.launchModel(model, launchBackend);
      }),
    ]);
  }

  function visibleModels(): LocalModelInfo[] {
    const term = search.trim().toLowerCase();
    const models = state.localModels.filter(
      (model) =>
        term.length === 0 ||
        model.name.toLowerCase().includes(term) ||
        model.path.toLowerCase().includes(term),
    );

    const sorted = [...models];
    sorted.sort((a, b) => {
      if (sortMode === 'favorites') {
        const rank = Number(favorites.has(b.path)) - Number(favorites.has(a.path));
        return rank || a.name.localeCompare(b.name);
      }
      if (sortMode === 'name-asc') return a.name.localeCompare(b.name);
      if (sortMode === 'name-desc') return b.name.localeCompare(a.name);
      if (sortMode === 'size-asc') return a.size - b.size;
      return b.size - a.size;
    });
    return sorted;
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

    const visible = visibleModels();
    const term = search.trim();

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

    const sortSelect = el(
      'select',
      {
        class: 'control model-sort',
        attrs: { 'aria-label': t('manage-sort') },
        on: {
          change: (event) => {
            sortMode = (event.target as HTMLSelectElement).value as SortMode;
            update();
          },
        },
      },
      SORT_MODES.map((mode) => option(mode, t(`sort-${mode}`), mode === sortMode)),
    );

    const list =
      visible.length === 0
        ? el('p', {
            class: 'manage-line muted',
            text: term.length > 0 ? t('manage-no-results') : t('manage-no-models'),
          })
        : el('div', { class: 'model-scroll' }, [
            el('div', { class: 'model-grid' }, visible.map(modelCard)),
          ]);

    const header = el('div', { class: 'manage-head manage-head-row' }, [
      el('h3', { class: 'manage-title' }, [icon('folder', 'icon small'), t('manage-local-models')]),
      el('div', { class: 'model-actions' }, tools),
    ]);

    const nodes: Node[] = [header];

    if (state.localModels.length > 0) {
      nodes.push(
        el('div', { class: 'model-tools' }, [
          el('label', { class: 'search' }, [icon('search', 'icon small'), searchInput]),
          sortSelect,
        ]),
      );
    }

    if (installed.length > 0) {
      nodes.push(
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, [icon('play', 'icon small'), t('manage-launch-with')]),
          backendSelect,
        ]),
      );
    } else {
      nodes.push(el('p', { class: 'manage-line muted', text: t('manage-not-installed') }));
    }

    nodes.push(
      el('p', {
        class: 'manage-line muted',
        text: t('manage-model-count', { count: visible.length }),
      }),
    );
    nodes.push(list);

    return el('div', { class: 'manage-card' }, nodes);
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

    const modal = configModal();
    if (modal) element.append(modal);

    if (restoring) {
      const input = element.querySelector<HTMLInputElement>('.model-search');
      input?.focus();
      if (caret !== null) input?.setSelectionRange(caret, caret);
    }
  }

  return { element, update };
}
