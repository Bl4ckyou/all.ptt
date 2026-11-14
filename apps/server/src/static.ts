import type { ServerResponse } from 'node:http';
import { webAssets } from './generated/assets.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

export function serveStatic(res: ServerResponse, pathname: string): boolean {
  let key = pathname;
  if (!webAssets[key]) {
    if (pathname.includes('.')) return false;
    key = '/index.html';
  }

  const asset = webAssets[key];
  if (!asset) return false;

  const body = asset.text !== undefined
    ? Buffer.from(asset.text)
    : Buffer.from(asset.base64 ?? '', 'base64');

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extensionOf(key)] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  res.end(body);
  return true;
}
