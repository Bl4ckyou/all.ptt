import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ensureApp,
  findChrome,
  launchBrowser,
  type AppHandle,
  type Browser,
  type BrowserPage,
} from '../../test/browser-harness.js';

const REQUESTED_APP_URL = process.env.PTT_URL ?? 'http://127.0.0.1:5173';
const REQUESTED_API_URL = process.env.PTT_API_URL ?? 'http://127.0.0.1:4750/api/i18n';

let chromeError: string | null = null;
try {
  findChrome();
} catch (error) {
  chromeError = (error as Error).message;
  console.warn(`[ui] UI tests skipped: ${chromeError}`);
}

let appUrl = REQUESTED_APP_URL;
let app: AppHandle;
let browser: Browser;

beforeAll(async () => {
  if (chromeError) return;
  app = await ensureApp({ appUrl: REQUESTED_APP_URL, apiUrl: REQUESTED_API_URL });
  appUrl = app.appUrl;
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  if (chromeError) return;
  try {
    await browser?.close();
  } finally {
    await app?.stop();
  }
});

async function openManage(page: BrowserPage, width: number, height: number): Promise<void> {
  await page.setViewport(width, height);
  await page.navigate(appUrl);
  await page.evaluate(`localStorage.clear(); localStorage.setItem('ptt.locale', 'fr')`);
  await page.reload();
  await page.waitFor('!!document.querySelector(".nav-button")');
  await page.clickText('Gérer', '.nav-button');
  await page.waitFor('!!document.querySelector("#manage-tab-models")');
  await page.waitFor('!!document.querySelector(".manage-meta")');
  await page.waitFor('!document.querySelector(".manage-busy")', { timeout: 30_000 });
  await page.waitFor(
    `Number(document.querySelector('#manage-tab-backends')?.textContent?.match(/\\d+/)?.[0] ?? 0) > 0`,
    { timeout: 30_000 },
  );
  page.errors.length = 0;
}

async function modelTotal(page: BrowserPage): Promise<number> {
  return Number((await page.text('.manage-meta'))?.match(/\d+/)?.[0] ?? 0);
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

describe.skipIf(chromeError !== null)('manage view', () => {
  it('fits the desktop viewport without inner scrolling', async (context) => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const total = await modelTotal(page);
      if (total === 0) context.skip('no local models available');
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
      expect(metrics.cards).toBe(Math.min(total, 9));
      if (total > 9) {
        expect(await page.text('.manage-page-label')).toMatch(/^Page 1 \/ \d+$/);
      } else {
        expect(await page.count('.manage-pager')).toBe(0);
      }
      expect(page.errors).toEqual([]);
    });
  });

  it('paginates and disables the expected controls', async (context) => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const previous = '[aria-label="Page précédente"]';
      const next = '[aria-label="Page suivante"]';
      const total = await modelTotal(page);
      const pageSize = await page.count('.model-card');
      if (total === 0 || total <= pageSize) context.skip('not enough local models to paginate');
      expect(await page.isDisabled(previous)).toBe(true);

      const pageCount = Math.ceil(total / pageSize);
      const lastPageCount = total - (pageCount - 1) * pageSize;

      const label = (number: number): string => `Page ${number} / ${pageCount}`;
      const waitForPage = (number: number): Promise<void> =>
        page.waitFor(
          `document.querySelector('.manage-page-label')?.textContent?.includes(${JSON.stringify(label(number))})`,
        );

      const firstNames = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.model-card .model-name')].map((node) => node.textContent ?? '')`,
      );
      await page.click(next);
      await waitForPage(2);
      const secondNames = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.model-card .model-name')].map((node) => node.textContent ?? '')`,
      );
      expect(secondNames).not.toEqual(firstNames);
      expect(await page.isDisabled(previous)).toBe(false);

      for (let current = 3; current <= pageCount; current += 1) {
        await page.click(next);
        await waitForPage(current);
      }
      expect(await page.isDisabled(next)).toBe(true);
      expect(await page.count('.model-card')).toBe(lastPageCount);

      await page.click(previous);
      await waitForPage(pageCount - 1);
    });
  });

  it('filters models, resets pagination and shows an empty state', async (context) => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      const total = await modelTotal(page);
      if (total === 0) context.skip('no local models available');
      const firstName = (await page.text('.model-card:first-child .model-name')) ?? '';
      const term = firstName.split(/[-_.\s]/).find((part) => part.length >= 3) ?? firstName.slice(0, 4);
      await page.setValue('.model-search', term);
      await page.waitFor(`document.querySelectorAll('.model-card').length > 0`);
      const names = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.model-card .model-name')].map((node) => node.textContent ?? '')`,
      );
      expect(names.every((name) => name.toLowerCase().includes(term.toLowerCase()))).toBe(true);
      expect(await page.count('.manage-pager')).toBe(0);

      await page.setValue('.model-search', '');
      await page.waitFor(`document.querySelectorAll('.model-card').length === ${Math.min(total, 9)}`);
      if (total > 9) {
        expect(await page.text('.manage-page-label')).toMatch(/^Page 1 \/ \d+$/);
      }

      await page.setValue('.model-search', 'modele-inexistant');
      await page.waitFor(`!!document.querySelector('.manage-empty')`);
      expect(await page.count('.model-card')).toBe(0);
    });
  });

  it('switches between models and backends', async () => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('true');
      const totalBackends = Number((await page.text('#manage-tab-backends'))?.match(/\d+/)?.[0] ?? 0);
      expect(totalBackends).toBeGreaterThan(0);

      await page.click('#manage-tab-backends');
      await page.waitFor(`!!document.querySelector('.backend-card')`);
      expect(await page.attribute('#manage-tab-backends', 'aria-selected')).toBe('true');
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('false');
      expect(await page.count('.backend-card')).toBe(totalBackends);
      expect(await page.count('.model-card')).toBe(0);

      await page.click('#manage-tab-models');
      await page.waitFor(`!!document.querySelector('.manage-meta')`);
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
      await page.waitFor(`!!document.querySelector('.manage-meta')`);
      expect(await page.attribute('#manage-tab-models', 'aria-selected')).toBe('true');
    });
  });

  it('keeps favorites after a reload', async (context) => {
    await withManage({ width: 1360, height: 920 }, async (page) => {
      if ((await modelTotal(page)) === 0) context.skip('no local models available');
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

  it('stays scroll-free on tablet and adapts the page size', async (context) => {
    await withManage({ width: 900, height: 900 }, async (page) => {
      if ((await modelTotal(page)) === 0) context.skip('no local models available');
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
      expect(metrics.cards).toBeGreaterThan(0);
      expect(metrics.cards).toBeLessThanOrEqual(3);
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
