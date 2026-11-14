import { sendJson } from '../http.js';
import type { Handler } from '../router.js';

export const healthRoute: Handler = ({ res }) => {
  sendJson(res, 200, { status: 'ok' });
};
