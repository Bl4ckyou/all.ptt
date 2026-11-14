import { el } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

export function openNotesModal(
  initial: string,
  onSave: (content: string) => Promise<void> | void,
): void {
  const textarea = el('textarea', {
    class: 'control notes-area',
    value: initial,
    attrs: { placeholder: t('project-context-hint') },
  });

  const close = (): void => overlay.remove();

  const saveButton = el('button', {
    class: 'button',
    on: {
      click: () => {
        saveButton.disabled = true;
        void Promise.resolve(onSave(textarea.value))
          .then(close)
          .finally(() => {
            saveButton.disabled = false;
          });
      },
    },
  }, [icon('check'), t('manage-config-save')]);

  const modal = el('div', {
    class: 'modal',
    on: { click: (event) => event.stopPropagation() },
  }, [
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'modal-heading' }, [
        el('h3', { class: 'modal-title', text: t('project-context-title') }),
        el('span', { class: 'modal-subtitle' }, [icon('fileText', 'icon small'), t('project-context-hint')]),
      ]),
      el('button', {
        class: 'icon-button',
        attrs: { title: t('manage-config-cancel'), 'aria-label': t('manage-config-cancel') },
        on: { click: close },
      }, [icon('x')]),
    ]),
    textarea,
    el('div', { class: 'modal-foot' }, [
      el('button', { class: 'button', on: { click: close } }, [icon('x'), t('manage-config-cancel')]),
      saveButton,
    ]),
  ]);

  const overlay = el('div', { class: 'modal-backdrop', on: { click: close } }, [modal]);
  document.body.append(overlay);
  textarea.focus();
}
