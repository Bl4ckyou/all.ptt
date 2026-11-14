import type { Actions } from '../actions.js';
import { el } from '../dom.js';
import { t } from '../i18n.js';
import { icon, type IconName } from '../icons.js';
import { state } from '../state.js';

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function button(
  iconName: IconName,
  label: string,
  onClick: () => void,
  danger = false,
): HTMLButtonElement {
  return el(
    'button',
    { class: `button${danger ? ' danger' : ''}`, on: { click: onClick } },
    [icon(iconName), label],
  );
}

export function createJobBar(actions: Actions): { element: HTMLElement; update(): void } {
  const element = el('div', { class: 'jobbar' });

  function update(): void {
    const job = state.job;
    element.hidden = !job;
    if (!job) {
      element.replaceChildren();
      return;
    }

    const progress = job.progress;
    const percent =
      progress.total > 0
        ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
        : null;

    const fill = el('div', { class: 'jobbar-fill' });
    if (percent === null) fill.classList.add('indeterminate');
    else fill.style.width = `${percent}%`;

    const phase =
      job.status === 'paused'
        ? t('job-paused')
        : job.status === 'error'
          ? t('job-error')
          : job.status === 'cancelled'
            ? t('job-cancelled')
            : job.status === 'done'
              ? t('job-done')
              : t(`job-${progress.phase}`);

    const parts = [
      progress.asset ?? '',
      progress.total > 0 ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}` : '',
      percent !== null ? `${percent}%` : '',
      job.error ?? '',
    ].filter(Boolean);

    const controls: Node[] = [];
    if (job.status === 'running') {
      controls.push(button('pause', t('job-pause'), () => void actions.pauseJob()));
    }
    if (job.status === 'paused') {
      controls.push(button('play', t('job-resume'), () => void actions.resumeJob()));
    }
    if (job.status === 'running' || job.status === 'paused') {
      controls.push(button('x', t('job-cancel'), () => void actions.cancelJob(), true));
    }

    element.replaceChildren(
      el('span', { class: 'jobbar-label' }, [icon('download'), progress.label]),
      el('div', { class: 'jobbar-track' }, [fill]),
      el('span', {
        class: 'jobbar-status',
        text: parts.length > 0 ? `${phase} · ${parts.join(' · ')}` : phase,
      }),
      ...controls,
    );
  }

  return { element, update };
}
