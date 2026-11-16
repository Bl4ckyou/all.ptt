import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ensureApp,
  launchBrowser,
  type AppHandle,
  type Browser,
  type BrowserPage,
} from '../browser-harness.js';

const APP_URL = process.env.PTT_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.PTT_API_URL ?? 'http://127.0.0.1:4750/api/i18n';

let app: AppHandle;
let browser: Browser;

beforeAll(async () => {
  app = await ensureApp({ appUrl: APP_URL, apiUrl: API_URL });
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

async function openManage(page: BrowserPage, width: number, height: number): Promise<void> {
  await page.setViewport(width, height);
  await page.navigate(APP_URL);
  await page.evaluate(`localStorage.clear(); localStorage.setItem('ptt.locale', 'fr')`);
  await page.reload();
  await page.waitFor('!!document.querySelector(".nav-button")');
  await page.clickText('Gérer', '.nav-button');
  await page.waitFor('!!document.querySelector("#manage-tab-models")');
  await page.waitFor('document.querySelectorAll(".model-card").length > 0');
  page.errors.length = 0;
}

async function withManage(
  viewport: { width: number; height: number },
  run: (page: BrowserPage) => Promise<void>,
): Promise<void> {
  const page = await browser.newPage();
  try {
    await openManage(page, viewport.width, viewport.height);
    await run(page);
  } finally {
    await page.close();
  }
}

describe('manage view', () => {
  it('fits the desktop viewport without inner scrolling', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const metrics = await page.evaluate<{
        overflowY: number;
        overflowX: number;
        columns: number;
        cards: number;
      }>(`(() => {
        const manage = document.querySelector('.manage');
        const grid = document.querySelector('.model-grid');
        return {
          overflowY: manage.scrollHeight - manage.clientHeight,
          overflowX: manage.scrollWidth - manage.clientWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          cards: document.querySelectorAll('.model-card').length,
        };
      })()`);
      expect(metrics.overflowY).toBe(0);
      expect(metrics.overflowX).toBe(0);
      expect(metrics.columns).toBe(3);
      expect(metrics.cards).toBe(9);
      expect(await page.text('.manage-page-label')).toContain('Page 1 / 4');
      expect(page.errors).toEqual([]);
    });
  });

  it('paginates and disables the expected controls', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const previous = '[aria-label="Page précédente"]';
      const next = '[aria-label="Page suivante"]';
      expect(await page.isDisabled(previous)).toBe(true);

      const firstNames = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.model-card .model-name')].map((node) => node.textContent ?? '')`,
      );
      await page.click(next);
      await page.waitFor(
        `document.querySelector('.manage-page-label')?.textContent?.includes('Page 2 / 4')`,
      );
      const secondNames = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.model-card .model-name')].map((node) => node.textContent ?? '')`,
      );
      expect(secondNames).not.toEqual(firstNames);
      expect(await page.isDisabled(previous)).toBe(false);

      await page.click(next);
      await page.click(next);
      await page.waitFor(
        `document.querySelector('.manage-page-label')?.textContent?.includes('Page 4 / 4')`,
      );
      expect(await page.isDisabled(next)).toBe(true);
      expect(await page.count('.model-card')).toBe(6);

      await page.click(previous);
      await page.waitFor(
        `document.querySelector('.manage-page-label')?.textContent?.includes('Page 3 / 4')`,
      );
    });
  });

  it('filters models, resets pagination and shows an empty state', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      await page.setValue('.model-search', 'gemma');
      await page.waitFor(`document.querySelectorAll('.model-card').length === 4`);
      expect(await page.text('.manage-meta')).toMatch(/^4\b/);
      expect(await page.count('.manage-pager')).toBe(0);

      await page.setValue('.model-search', '');
      await page.waitFor(`document.querySelectorAll('.model-card').length === 9`);
      await page.waitFor(
        `document.querySelector('.manage-page-label')?.textContent?.includes('Page 1 / 4')`,
      );

      await page.setValue('.model-search', 'modele-inexistant');
      await page.waitFor(`!!document.querySelector('.manage-empty')`);
      expect(await page.count('.model-card')).toBe(0);
    });
  });

  it('switches between models and backends', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('true');

      await page.click('#manage-tab-backends');
      await page.waitFor(`!!document.querySelector('.backend-card')`);
      expect(await page.attribute('#manage-tab-backends', 'aria-selected')).toBe('true');
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('false');
      expect(await page.count('.backend-card')).toBe(2);
      expect(await page.count('.model-card')).toBe(0);

      await page.click('#manage-tab-models');
      await page.waitFor(`!!document.querySelector('.model-card')`);
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('true');
    });
  });

  it('switches tabs with the arrow keys and moves focus', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      await page.focus('#manage-tab-models');
      await page.dispatchKey('#manage-tab-models', 'ArrowRight');
      await page.waitFor(`!!document.querySelector('.backend-card')`);
      expect(await page.attribute('#manage-tab-backends', 'aria-selected')).toBe('true');
      expect(await page.evaluate('document.activeElement?.id ?? null')).toBe('manage-tab-backends');

      await page.dispatchKey('#manage-tab-backends', 'ArrowLeft');
      await page.waitFor(`!!document.querySelector('.model-card')`);
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('true');
    });
  });

  it('keeps favorites after a reload', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const path = await page.attribute('.model-card:first-child .model-name', 'title');
      const name = (await page.text('.model-card:first-child .model-name')) ?? '';
      expect(path).toBeTruthy();

      await page.click('.model-card:first-child [aria-label="Ajouter aux favoris"]');
      await page.waitFor(
        `JSON.parse(localStorage.getItem('ptt.favorites') ?? '[]').includes(${JSON.stringify(path)})`,
      );

      await page.reload();
      await page.waitFor('!!document.querySelector(".nav-button")');
      await page.clickText('Gérer', '.nav-button');
      await page.waitFor('document.querySelectorAll(".model-card").length > 0');
      const favorite = await page.evaluate<boolean>(`(() => {
        const card = [...document.querySelectorAll('.model-card')]
          .find((candidate) => (candidate.querySelector('.model-name')?.textContent ?? '').includes(${JSON.stringify(name)}));
        return Boolean(card?.querySelector('[aria-label="Retirer des favoris"]'));
      })()`);
      expect(favorite).toBe(true);
    });
  });

  it('opens and closes the add-backend modal with Escape', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      await page.clickText('Ajouter un backend');
      await page.waitFor(`!!document.querySelector('.modal-backdrop')`);
      await page.dispatchKey(null, 'Escape');
      await page.waitFor(`!document.querySelector('.modal-backdrop')`);
    });
  });

  it('stays scroll-free on tablet and adapts the page size', async () => {
    await withManage({ width: 900, height: 900 }, async (page) => {
      const metrics = await page.evaluate<{ overflowY: number; columns: number; cards: number }>(`(() => {
        const manage = document.querySelector('.manage');
        const grid = document.querySelector('.model-grid');
        return {
          overflowY: manage.scrollHeight - manage.clientHeight,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          cards: document.querySelectorAll('.model-card').length,
        };
      })()`);
      expect(metrics.overflowY).toBe(0);
      expect(metrics.columns).toBe(1);
      expect(metrics.cards).toBe(3);
    });
  });

  it('falls back to scrolling and a stacked dashboard on mobile', async () => {
    await withManage({ width: 430, height: 900 }, async (page) => {
      const metrics = await page.evaluate<{ overflowY: string; statusColumns: number }>(`(() => {
        const manage = document.querySelector('.manage');
        return {
          overflowY: getComputedStyle(manage).overflowY,
          statusColumns: getComputedStyle(document.querySelector('.manage-status')).gridTemplateColumns.split(' ').length,
        };
      })()`);
      expect(metrics.overflowY).toBe('auto');
      expect(metrics.statusColumns).toBe(1);
    });
  });
});
