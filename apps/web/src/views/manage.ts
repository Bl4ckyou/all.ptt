import { cacheTypeBytes, estimateMemory, formatBytes, type GgufModelInfo } from '@ptt/core';
import type { Actions } from '../actions.js';
import { openAddBackendModal } from './add-backend-modal.js';
import { el, option } from '../dom.js';
import { currentLocale, t } from '../i18n.js';
import { icon, type IconName } from '../icons.js';
import { draftCategory, draftMatchScore, mmprojMatchScore } from '../matching.js';
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
  let configInfo: GgufModelInfo | null = null;
  let configSpecTypes: Record<string, string> = {};
  let configAvailableSpecTypes = new Set<string>();
  let configRows = new Map<string, { setting: ResolvedSettingInfo; element: HTMLElement }>();
  let configSections: HTMLElement[] = [];
  let configAdvanced: HTMLDetailsElement | null = null;
  let configSaving = false;
  let configError: string | null = null;
  let configNode: HTMLElement | null = null;
  let settingsHost: HTMLElement | null = null;
  let estimateEl: HTMLElement | null = null;
  let backendSelectEl: HTMLSelectElement | null = null;
  let extraInputEl: HTMLInputElement | null = null;
  let saveButtonEl: HTMLButtonElement | null = null;

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

  function installedBackends(): { id: string; label: string; shortLabel: string }[] {
    return state.backends
      .filter((backend) => backend.installed.length > 0)
      .map((backend) => ({
        id: backend.id,
        label: backend.label,
        shortLabel: backend.shortLabel,
      }));
  }

  function dependsOnSatisfied(
    setting: ResolvedSettingInfo,
    values: Record<string, SettingValue>,
  ): boolean {
    if (!setting.dependsOn) return true;
    const current = values[setting.dependsOn.setting];
    if (current === undefined) return false;
    const text = String(current);
    if (text === 'none') return false;
    if (setting.dependsOn.values && !setting.dependsOn.values.includes(text)) return false;
    if (setting.dependsOn.includes && !text.includes(setting.dependsOn.includes)) return false;
    return true;
  }

  function shortPath(path: string): string {
    return path.split(/[/\\]/).slice(-2).join('/');
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
    const isLocal = backend.kind === 'local';

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

    const current = backend.installed.find((entry) => entry.variant === choice);
    const latestTag = current ? state.backendLatest[backend.id]?.[current.target] : undefined;
    const upToDate = Boolean(current && latestTag && latestTag === current.tag);
    const updateTag = current && latestTag && latestTag !== current.tag ? latestTag : null;

    const action = isLocal
      ? el('span', { class: 'status-pill good', text: t('backend-external') })
      : button(
          current ? 'refresh' : 'download',
          upToDate ? t('backend-up-to-date') : current ? t('manage-update') : t('manage-install'),
          () => void actions.installBackend(backend.id, choice),
        );
    if (action instanceof HTMLButtonElement) action.disabled = upToDate;

    const remove = backend.custom
      ? button('x', t('backend-remove'), () => void actions.removeBackend(backend.id), true)
      : null;

    const status = installed
      ? el('div', { class: 'backend-status' }, [
          el('span', {
            class: 'manage-line muted',
            text: backend.installed.map((entry) => `${entry.variant} · ${entry.tag}`).join(', '),
          }),
          upToDate
            ? el('span', { class: 'status-pill good', text: t('backend-up-to-date') })
            : updateTag
              ? el('span', {
                  class: 'status-pill update',
                  text: t('backend-update-available', { tag: updateTag }),
                })
              : el('span'),
        ])
      : el('p', { class: 'manage-line muted', text: t('manage-not-installed') });

    return el('div', { class: 'backend-card' }, [
      el('div', { class: 'manage-head' }, [
        el('span', { class: 'manage-name' }, [icon('server', 'icon small'), backend.label]),
        el('span', { class: 'manage-line muted', text: backend.repo }),
      ]),
      el('div', { class: 'manage-row' }, [select, action, ...(remove ? [remove] : [])]),
      status,
    ]);
  }

  function numberValue(value: SettingValue | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function updateEstimate(): void {
    if (!estimateEl) return;
    if (!configInfo) {
      estimateEl.textContent = '';
      return;
    }

    const estimate = estimateMemory(configInfo, {
      gpuLayers: numberValue(configValues['gpu-layers']),
      contextSize: numberValue(configValues['context-size']) ?? configInfo.contextLength ?? 0,
      cacheTypeKBytes: cacheTypeBytes(configValues['cache-type-k']),
      cacheTypeVBytes: cacheTypeBytes(configValues['cache-type-v']),
    });

    estimateEl.textContent = t('manage-memory-estimate', {
      ram: formatBytes(estimate.ramBytes),
      vram: formatBytes(estimate.vramBytes),
    });
  }

  function filePicker(
    setting: ResolvedSettingInfo,
    current: SettingValue | undefined,
  ): HTMLElement {
    const pool: LocalModelInfo[] =
      setting.fileKind === 'mmproj'
        ? state.auxiliary.filter((file) => file.kind === 'mmproj')
        : setting.fileKind === 'mtp'
          ? state.drafts.filter((file) => (file.category ?? 'other') === 'mtp')
          : [...state.drafts, ...state.localModels];

    const seenPaths = new Set<string>();
    const candidates: LocalModelInfo[] = [];
    for (const file of pool) {
      if (file.path === configModel?.path || seenPaths.has(file.path)) continue;
      seenPaths.add(file.path);
      candidates.push(file);
    }

    const categoryOf = (file: LocalModelInfo): string => file.category ?? draftCategory(file.name);

    const CATEGORY_RANK: Record<string, number> = {
      assistant: 0,
      dflash: 0,
      dflash2: 0,
      dspark: 0,
      eagle3: 0,
      lilicorr: 0,
      mtp: 0,
      other: 1,
    };

    const scored = candidates.map((file) => ({
      file,
      score:
        setting.fileKind === 'mmproj'
          ? mmprojMatchScore(file, configModel)
          : draftMatchScore(file, configModel),
    }));

    const base = scored
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (setting.fileKind === 'model'
            ? (CATEGORY_RANK[categoryOf(a.file)] ?? 1) -
              (CATEGORY_RANK[categoryOf(b.file)] ?? 1)
            : 0) ||
          a.file.name.localeCompare(b.file.name),
      )
      .map((entry) => entry.file);

    const supportedCategories = Object.keys(configSpecTypes);
    const categories =
      setting.fileKind === 'model'
        ? (
            ['assistant', 'dflash', 'dflash2', 'dspark', 'eagle3', 'lilicorr', 'mtp', 'other'] as const
          ).filter(
            (category) =>
              base.some((file) => categoryOf(file) === category) &&
              (supportedCategories.length === 0 || supportedCategories.includes(category)),
          )
        : [];
    let activeCategory: string = 'all';

    const input = el('input', {
      class: 'control file-value',
      value: current === undefined ? '' : String(current),
      attrs: { type: 'text', placeholder: t('manage-path-placeholder') },
      on: {
        input: (event) => {
          const raw = (event.target as HTMLInputElement).value;
          if (raw === '') delete configValues[setting.id];
          else configValues[setting.id] = raw;
          refresh();
        },
      },
    });

    const tabs = el('div', { class: 'file-tabs' });
    const suggestions = el('div', { class: 'file-suggestions' });

    function renderTabs(): void {
      if (categories.length < 2) {
        tabs.replaceChildren();
        return;
      }

      const makeTab = (value: string, label: string): HTMLButtonElement =>
        el(
          'button',
          {
            class: `file-tab${activeCategory === value ? ' active' : ''}`,
            attrs: { type: 'button' },
            on: {
              click: () => {
                activeCategory = value;
                renderTabs();
                refresh();
              },
            },
          },
          [label],
        );

      tabs.replaceChildren(
        makeTab('all', t('file-category-all')),
        ...categories.map((category) => makeTab(category, t(`file-category-${category}`))),
      );
    }

    function refresh(): void {
      const term = input.value.trim().toLowerCase();
      let pool = base;

      if (activeCategory !== 'all') {
        pool = pool.filter((file) => categoryOf(file) === activeCategory);
      }
      if (term.length > 0) {
        pool = pool.filter(
          (file) =>
            file.name.toLowerCase().includes(term) || file.path.toLowerCase().includes(term),
        );
      }

      const items = pool.slice(0, 30);

      if (items.length === 0) {
        suggestions.replaceChildren(
          el('p', {
            class: 'manage-line muted',
            text: base.length === 0 ? t('manage-no-matching-file') : t('manage-no-results'),
          }),
        );
        return;
      }

      suggestions.replaceChildren(
        ...items.map((file) =>
          el(
            'button',
            {
              class: 'file-option',
              attrs: { type: 'button' },
              on: {
              click: () => {
                configValues[setting.id] = file.path;
                if (setting.fileKind === 'model') {
                  const specType = configSpecTypes[categoryOf(file)];
                  if (specType) {
                    configValues['spec-type'] = specType;
                    setSelectValue('spec-type', specType);
                  }
                }
                input.value = file.path;
                refresh();
                refreshSettingsVisibility();
              },
              },
            },
            [
              el('span', { class: 'file-option-name', text: file.name }),
              el('span', { class: 'file-option-path', text: shortPath(file.path) }),
            ],
          ),
        ),
      );
    }

    const clear = iconButton('x', t('manage-config-clear'), () => {
      delete configValues[setting.id];
      input.value = '';
      refresh();
    });

    renderTabs();
    refresh();

    const nodes: Node[] = [el('div', { class: 'file-picker-row' }, [input, clear])];
    if (categories.length >= 2) nodes.push(tabs);
    nodes.push(suggestions);

    return el('div', { class: 'file-picker' }, nodes);
  }

  function settingControl(setting: ResolvedSettingInfo): HTMLElement {
    const current = configValues[setting.id] ?? setting.default;

    if (setting.type === 'path') {
      return filePicker(setting, current);
    }

    if (setting.type === 'boolean') {
      const checkbox = el('input', {
        class: 'toggle',
        attrs: { type: 'checkbox', ...(current === true ? { checked: '' } : {}) },
        on: {
          change: (event) => {
            configValues[setting.id] = (event.target as HTMLInputElement).checked;
            updateEstimate();
            refreshSettingsVisibility();
          },
        },
      });
      return el('label', { class: 'switch' }, [checkbox, el('span', { class: 'switch-track' })]);
    }

    if (setting.type === 'enum') {
      let choices = setting.choices ?? [];
      if (setting.id === 'spec-type' && configAvailableSpecTypes.size > 0) {
        choices = choices.filter((choice) => configAvailableSpecTypes.has(choice));
        if (
          typeof current === 'string' &&
          current !== '' &&
          current !== 'none' &&
          !choices.includes(current)
        ) {
          choices = [current, ...choices];
        }
      }

      const options: HTMLOptionElement[] = [];
      if (setting.default === undefined) {
        options.push(option('', '—', current === undefined || current === ''));
      }
      for (const choice of choices) options.push(option(choice, choice, choice === current));

      return el(
        'select',
        {
          class: 'control',
          on: {
            change: (event) => {
              configValues[setting.id] = (event.target as HTMLSelectElement).value;
              updateEstimate();
              refreshSettingsVisibility();
            },
          },
        },
        options,
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
          updateEstimate();
          refreshSettingsVisibility();
        },
      },
    });
  }

  function settingRow(setting: ResolvedSettingInfo): HTMLElement {
    return el('div', { class: `setting-row${setting.type === 'path' ? ' path-row' : ''}` }, [
      el('div', { class: 'setting-info' }, [
        el('span', {
          class: 'setting-name',
          text: setting.label ?? t(`setting-${setting.id}`),
        }),
        el('span', {
          class: 'setting-desc muted',
          text: setting.descriptionKey ? t(setting.descriptionKey) : (setting.description ?? ''),
        }),
      ]),
      settingControl(setting),
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

  const CATEGORY_ORDER = [
    'model',
    'performance',
    'cpu',
    'gpu',
    'sampling',
    'speculative',
    'multimodal',
    'mtp',
  ];

  function categoryGroups(
    settings: ResolvedSettingInfo[],
  ): [string, ResolvedSettingInfo[]][] {
    const groups = new Map<string, ResolvedSettingInfo[]>();
    for (const setting of settings) {
      const list = groups.get(setting.category) ?? [];
      list.push(setting);
      groups.set(setting.category, list);
    }
    return [...groups.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    );
  }

  function renderGroup(settings: ResolvedSettingInfo[]): HTMLElement {
    const wrapper = el('div', { class: 'setting-groups' });
    for (const [category, items] of categoryGroups(settings)) {
      const section = el('section', { class: 'setting-group' });
      section.append(el('h4', { class: 'setting-group-title', text: t(`category-${category}`) }));

      const list = el('div', { class: 'setting-list' });
      for (const item of items) {
        const row = settingRow(item);
        configRows.set(item.id, { setting: item, element: row });
        list.append(row);
      }

      section.append(list);
      wrapper.append(section);
      configSections.push(section);
    }
    return wrapper;
  }

  function refreshSettingsVisibility(): void {
    for (const { setting, element } of configRows.values()) {
      element.hidden = !dependsOnSatisfied(setting, configValues);
    }

    for (const section of configSections) {
      const rows = [...section.querySelectorAll<HTMLElement>('.setting-row')];
      section.hidden = rows.length > 0 && rows.every((row) => row.hidden);
    }

    if (configAdvanced) {
      const rows = [...configAdvanced.querySelectorAll<HTMLElement>('.setting-row')];
      configAdvanced.hidden = rows.length === 0 || rows.every((row) => row.hidden);
    }
  }

  function setSelectValue(id: string, value: string): void {
    const select = configRows.get(id)?.element.querySelector('select');
    if (!select) return;

    if (![...select.options].some((choice) => choice.value === value)) {
      select.append(option(value, value, false));
    }
    select.value = value;
  }

  function renderSettings(): void {
    if (!settingsHost) return;
    settingsHost.replaceChildren();
    configRows = new Map();
    configSections = [];
    configAdvanced = null;

    if (configError) {
      settingsHost.append(el('p', { class: 'error' }, [icon('x'), t(configError)]));
    } else if (configSettings.length === 0) {
      settingsHost.append(el('p', { class: 'manage-line muted', text: t('manage-config-none') }));
    } else {
      const basic = configSettings.filter((setting) => !setting.advanced);
      const advanced = configSettings.filter((setting) => setting.advanced);

      if (basic.length > 0) settingsHost.append(renderGroup(basic));
      if (advanced.length > 0) {
        configAdvanced = el('details', { class: 'advanced' }, [
          el('summary', { class: 'advanced-summary' }, [
            icon('manage', 'icon small'),
            t('manage-advanced'),
          ]),
          renderGroup(advanced),
        ]);
        settingsHost.append(configAdvanced);
      }
    }

    refreshSettingsVisibility();

    settingsHost.classList.remove('fade-in');
    void settingsHost.offsetWidth;
    settingsHost.classList.add('fade-in');
  }

  async function loadConfigBody(): Promise<void> {
    if (!configModel) return;
    const model = configModel;

    if (!configBackend) {
      configError = 'manage-not-installed';
      renderSettings();
      updateEstimate();
      return;
    }

    if (backendSelectEl) backendSelectEl.value = configBackend;
    configError = null;
    const hadContent = (settingsHost?.childElementCount ?? 0) > 0;
    if (hadContent) {
      settingsHost?.classList.add('loading');
    } else {
      settingsHost?.replaceChildren(
        el('p', { class: 'manage-busy' }, [icon('sparkles', 'icon small'), t('status-loading')]),
      );
    }
    updateEstimate();

    try {
      const [settingsInfo, config, info] = await Promise.all([
        actions.getBackendSettings(configBackend, currentLocale()),
        actions.getModelConfig(model.path),
        actions.getModelInfo(model.path),
      ]);
      configSettings = settingsInfo.settings;
      configSpecTypes = settingsInfo.categorySpecTypes ?? {};
      configValues = defaultValues(configSettings, config?.settings ?? {});
      configExtra = config?.extraArgs ?? '';
      configInfo = info;

      const availableSpecTypes = new Set<string>();
      for (const file of [...state.drafts, ...state.localModels]) {
        if (draftMatchScore(file, model) <= 0) continue;
        const category = file.category ?? draftCategory(file.name);
        const specType = configSpecTypes[category];
        if (specType) availableSpecTypes.add(specType);
      }
      if (model.hasMtp) {
        const mtpType = configSpecTypes.mtp;
        if (mtpType) availableSpecTypes.add(mtpType);
      }
      availableSpecTypes.add('none');
      const savedType = config?.settings?.['spec-type'];
      if (typeof savedType === 'string') availableSpecTypes.add(savedType);
      configAvailableSpecTypes = availableSpecTypes;

      if (configValues.mmproj === undefined) {
        const ranked = state.auxiliary
          .filter((file) => file.kind === 'mmproj')
          .map((file) => ({ file, score: mmprojMatchScore(file, model) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score);

        if (ranked.length > 0 && ranked[0].score > (ranked[1]?.score ?? 0)) {
          configValues.mmproj = ranked[0].file.path;
        }
      }
    } catch {
      configError = 'error-config';
    }

    if (extraInputEl) extraInputEl.value = configExtra;
    settingsHost?.classList.remove('loading');
    renderSettings();
    updateEstimate();
  }

  function closeConfig(): void {
    const node = configNode;
    configNode = null;
    configModel = null;
    settingsHost = null;
    estimateEl = null;
    backendSelectEl = null;
    extraInputEl = null;
    saveButtonEl = null;

    if (node) {
      node.classList.add('closing');
      setTimeout(() => node.remove(), 170);
    }
  }

  function buildConfigModal(model: LocalModelInfo): HTMLElement {
    settingsHost = el('div', { class: 'settings-host' });
    estimateEl = el('p', { class: 'memory-estimate' });

    backendSelectEl = el(
      'select',
      {
        class: 'control',
        on: {
          change: (event) => {
            configBackend = (event.target as HTMLSelectElement).value;
            void loadConfigBody();
          },
        },
      },
      installedBackends().map((backend) => option(backend.id, backend.label, backend.id === configBackend)),
    );

    extraInputEl = el('input', {
      class: 'control',
      value: configExtra,
      attrs: { type: 'text', placeholder: t('manage-config-extra-hint') },
      on: {
        input: (event) => {
          configExtra = (event.target as HTMLInputElement).value;
        },
      },
    });

    saveButtonEl = button('check', t('manage-config-save'), () => void saveConfig());

    const modal = el(
      'div',
      { class: 'modal', on: { click: (event) => event.stopPropagation() } },
      [
        el('div', { class: 'modal-head' }, [
          el('div', { class: 'modal-heading' }, [
            el('h3', { class: 'modal-title', text: model.name }),
            el('span', { class: 'modal-subtitle' }, [
              icon('model', 'icon small'),
              t('manage-model-config'),
            ]),
          ]),
          iconButton('x', t('manage-config-cancel'), closeConfig),
        ]),
        estimateEl,
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, [icon('server', 'icon small'), t('manage-launch-with')]),
          backendSelectEl,
        ]),
        settingsHost,
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, [icon('manage', 'icon small'), t('manage-config-extra')]),
          extraInputEl,
        ]),
        el('div', { class: 'modal-foot' }, [
          button('x', t('manage-config-cancel'), closeConfig),
          saveButtonEl,
        ]),
      ],
    );

    return el('div', { class: 'modal-backdrop', on: { click: closeConfig } }, [modal]);
  }

  async function openConfig(model: LocalModelInfo): Promise<void> {
    closeConfig();
    configModel = model;
    configBackend = launchBackend ?? installedBackends()[0]?.id ?? null;
    configSettings = [];
    configValues = {};
    configExtra = '';
    configInfo = null;
    configSpecTypes = {};
    configAvailableSpecTypes = new Set<string>();
    configError = null;
    configSaving = false;

    configNode = buildConfigModal(model);
    document.body.append(configNode);
    await loadConfigBody();
  }

  async function saveConfig(): Promise<void> {
    if (!configModel || configSaving) return;
    const path = configModel.path;
    configSaving = true;
    saveButtonEl?.replaceChildren(icon('sparkles'), t('status-loading'));

    try {
      await actions.saveModelConfig(path, configValues, configExtra);
      closeConfig();
    } catch {
      configError = 'error-config';
      configSaving = false;
      saveButtonEl?.replaceChildren(icon('check'), t('manage-config-save'));
      renderSettings();
    }
  }

  function modelCard(model: LocalModelInfo): HTMLElement {
    const favorite = favorites.has(model.path);

    return el('div', { class: 'model-card' }, [
      el('div', { class: 'model-card-head' }, [
        el('span', { class: 'model-name', attrs: { title: model.path } }, [
          icon('model', 'icon small'),
          model.name,
        ]),
        ...(model.quantization
          ? [el('span', { class: 'model-quant', text: model.quantization })]
          : []),
      ]),
      el('span', { class: 'manage-line muted', text: formatBytes(model.size) }),
      el('div', { class: 'model-card-actions' }, [
        button('play', t('manage-launch'), () => {
          if (launchBackend) void actions.launchModel(model, launchBackend);
        }),
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

    const backendSwitch =
      installed.length > 0
        ? el(
            'div',
            { class: 'segmented', attrs: { role: 'group', 'aria-label': t('manage-launch-with') } },
            installed.map((backend) =>
              el(
                'button',
                {
                  class: `segmented-option${backend.id === launchBackend ? ' active' : ''}`,
                  attrs: { type: 'button', title: backend.label },
                  on: {
                    click: () => {
                      launchBackend = backend.id;
                      update();
                    },
                  },
                },
                [backend.shortLabel],
              ),
            ),
          )
        : null;

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
          ...(backendSwitch ? [backendSwitch] : []),
        ]),
      );
    }

    if (installed.length === 0) {
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

    return el('div', { class: `manage-card${rows.length > 0 ? ' running-card' : ''}` }, [
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
        el('div', { class: 'manage-actions' }, [
          button('plus', t('backend-add'), () =>
            openAddBackendModal(actions, () => void actions.refreshBackends()),
          ),
          button('download', t('manage-update-project'), () => void actions.updateProject()),
          button('refresh', t('manage-update-all'), () => void actions.updateBackends()),
        ]),
      ]),
    ];

    if (state.busy) nodes.push(el('p', { class: 'manage-busy' }, [icon('sparkles', 'icon small'), t(state.busy)]));
    if (state.error) nodes.push(el('p', { class: 'error' }, [icon('x'), t(state.error)]));
    if (state.updateReady) {
      nodes.push(
        el('div', { class: 'manage-card' }, [
          el('p', { class: 'manage-line' }, [icon('check', 'icon small'), t('manage-update-ready')]),
          button('refresh', t('manage-restart'), () => void actions.restartProject()),
        ]),
      );
    }

    nodes.push(hardwareCard());
    nodes.push(runningCard());
    nodes.push(
      el('div', { class: 'manage-card' }, [
        el('h3', { class: 'manage-title' }, [icon('server', 'icon small'), t('backends-title')]),
        ...state.backends.map(backendCard),
      ]),
    );
    nodes.push(modelsCard());

    element.replaceChildren(...nodes);

    if (restoring) {
      const input = element.querySelector<HTMLInputElement>('.model-search');
      input?.focus();
      if (caret !== null) input?.setSelectionRange(caret, caret);
    }
  }

  return { element, update };
}
