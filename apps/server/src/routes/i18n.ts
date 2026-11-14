import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@ptt/i18n';
import { catalogs } from '../generated/assets.js';
import { sendJson, sendText } from '../http.js';
import type { Handler } from '../router.js';

export const i18nLocalesRoute: Handler = ({ res }) => {
  sendJson(res, 200, { defaultLocale: DEFAULT_LOCALE, locales: SUPPORTED_LOCALES });
};

export const i18nCatalogRoute: Handler = ({ res, params }) => {
  const source = catalogs[params.locale];
  if (!source) {
    sendJson(res, 404, { error: 'locale.not_found' });
    return;
  }
  sendText(res, 200, source);
};
