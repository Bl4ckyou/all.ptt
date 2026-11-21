import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, code: string): void {
  sendJson(res, status, { error: code });
}

const MAX_BODY_BYTES = 1024 * 1024;

export async function readJsonOrError<T>(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<T | null> {
  try {
    return await readJson<T>(req);
  } catch {
    sendError(res, 400, 'error.bad_request');
    return null;
  }
}

export async function readJsonOrFallback<T>(req: IncomingMessage, fallback: T): Promise<T> {
  try {
    return await readJson<T>(req);
  } catch {
    return fallback;
  }
}

export async function readJson<T>(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.destroy();
      throw new Error('request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
