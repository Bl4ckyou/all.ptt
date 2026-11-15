import type { Actions } from '../actions.js';
import { el, option } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

function field(label: string, input: HTMLInputElement): HTMLElement {
  return el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-info' }, [el('span', { class: 'setting-name', text: label })]),
    input,
  ]);
}

export function openAddBackendModal(actions: Actions, onDone: () => void): void {
  const idInput = el('input', { class: 'control', attrs: { placeholder: 'my-backend' } });
  const labelInput = el('input', { class: 'control', attrs: { placeholder: 'My backend' } });
  const pathInput = el('input', {
    class: 'control',
    attrs: { placeholder: '/opt/my-backend/server' },
  });
  const modelArgInput = el('input', { class: 'control', attrs: { placeholder: '--model' } });
  const healthInput = el('input', { class: 'control', attrs: { placeholder: '/health' } });

  const repoInput = el('input', { class: 'control', attrs: { placeholder: 'owner/repository' } });
  const binaryInput = el('input', { class: 'control', value: 'llama-server' });
  const assetSelect = el('select', { class: 'control' });
  const assets = new Map<string, { tag: string; asset: string }>();

  const error = el('p', { class: 'manage-line muted' });

  const localPanel = el('div', {}, [
    field(t('backend-path'), pathInput),
    field(t('backend-model-arg'), modelArgInput),
    field(t('backend-health'), healthInput),
  ]);

  const loadButton = el('button', {
    class: 'button',
    on: {
      click: () => {
        loadButton.disabled = true;
        error.textContent = '';
        void actions
          .browseBackendReleases(repoInput.value.trim())
          .then((releases) => {
            assets.clear();
            assetSelect.replaceChildren();
            for (const release of releases) {
              for (const entry of release.assets) {
                const key = `${release.tag}\u0000${entry.name}`;
                assets.set(key, { tag: release.tag, asset: entry.name });
                assetSelect.append(option(key, `${release.tag} — ${entry.name}`, false));
              }
            }
            if (assets.size === 0) error.textContent = t('backend-no-assets');
          })
          .catch(() => {
            error.textContent = t('backend-load-failed');
          })
          .finally(() => {
            loadButton.disabled = false;
          });
      },
    },
  }, [icon('download'), t('backend-load-releases')]);

  const githubPanel = el('div', {}, [
    field(t('backend-repo'), repoInput),
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-info' }, [
        el('span', { class: 'setting-name', text: t('backend-asset') }),
      ]),
      el('div', {}, [loadButton, assetSelect]),
    ]),
    field(t('backend-binary'), binaryInput),
  ]);

  let mode: 'local' | 'github' = 'local';

  const localTab = el('button', {
    class: 'segmented-option',
    text: t('backend-add-local'),
    on: { click: () => select('local') },
  });
  const githubTab = el('button', {
    class: 'segmented-option',
    text: t('backend-add-github'),
    on: { click: () => select('github') },
  });

  function select(next: 'local' | 'github'): void {
    mode = next;
    localPanel.hidden = mode !== 'local';
    githubPanel.hidden = mode !== 'github';
    localTab.classList.toggle('active', mode === 'local');
    githubTab.classList.toggle('active', mode === 'github');
  }

  const close = (): void => overlay.remove();

  const addButton = el('button', {
    class: 'button',
    on: {
      click: () => {
        addButton.disabled = true;
        error.textContent = '';

        const run =
          mode === 'local'
            ? actions.addLocalBackend({
                id: idInput.value.trim(),
                label: labelInput.value.trim(),
                path: pathInput.value.trim(),
                modelArg: modelArgInput.value.trim() || undefined,
                health: healthInput.value.trim() || undefined,
              })
            : (() => {
                const choice = assets.get(assetSelect.value);
                if (!choice) return Promise.reject(new Error('no asset'));
                return actions.addGithubBackend({
                  id: idInput.value.trim(),
                  label: labelInput.value.trim(),
                  repo: repoInput.value.trim(),
                  tag: choice.tag,
                  asset: choice.asset,
                  binaryName: binaryInput.value.trim() || undefined,
                });
              })();

        void run
          .then(() => {
            close();
            onDone();
          })
          .catch(() => {
            error.textContent = t('backend-add-failed');
          })
          .finally(() => {
            addButton.disabled = false;
          });
      },
    },
  }, [icon('plus'), t('backend-add-confirm')]);

  const modal = el('div', {
    class: 'modal',
    on: { click: (event) => event.stopPropagation() },
  }, [
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'modal-heading' }, [
        el('h3', { class: 'modal-title', text: t('backend-add') }),
        el('span', { class: 'modal-subtitle', text: t('backend-add-hint') }),
      ]),
      el('button', {
        class: 'icon-button',
        attrs: { title: t('manage-config-cancel'), 'aria-label': t('manage-config-cancel') },
        on: { click: close },
      }, [icon('x')]),
    ]),
    el('div', { class: 'modal-body' }, [
      el('div', { class: 'segmented' }, [localTab, githubTab]),
      field(t('backend-id'), idInput),
      field(t('backend-label'), labelInput),
      localPanel,
      githubPanel,
      error,
    ]),
    el('div', { class: 'modal-foot' }, [
      el('button', { class: 'button', on: { click: close } }, [
        icon('x'),
        t('manage-config-cancel'),
      ]),
      addButton,
    ]),
  ]);

  const overlay = el('div', { class: 'modal-backdrop', on: { click: close } }, [modal]);
  document.body.append(overlay);
  select('local');
  idInput.focus();
}
