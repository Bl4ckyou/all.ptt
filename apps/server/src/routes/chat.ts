import type { ChatMessage } from '@ptt/core';
import { sendError, readJsonOrError } from '../http.js';
import type { ProviderRegistry } from '../providers.js';
import type { Handler } from '../router.js';

interface ChatBody {
  providerId?: string;
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  const role = message.role;
  return (
    (role === 'system' || role === 'user' || role === 'assistant') &&
    typeof message.content === 'string'
  );
}

function isValidBody(
  body: ChatBody,
): body is ChatBody & Required<Pick<ChatBody, 'providerId' | 'model' | 'messages'>> {
  return (
    typeof body.providerId === 'string' &&
    typeof body.model === 'string' &&
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    body.messages.every(isMessage)
  );
}

export function chatRoute(registry: ProviderRegistry): Handler {
  return async ({ req, res }) => {
    const body = await readJsonOrError<ChatBody>(req, res);
    if (!body) return;

    if (!isValidBody(body)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const provider = registry.get(body.providerId);
    if (!provider) {
      sendError(res, 400, 'error.unknown_provider');
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const stream = provider.chat({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature,
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (res.writableEnded) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      if (!controller.signal.aborted && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', code: 'error.provider' })}\n\n`);
      }
    } finally {
      res.end();
    }
  };
}
