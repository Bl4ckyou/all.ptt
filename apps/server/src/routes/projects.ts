import type { AppContext } from '../context.js';
import { readJson, sendError, sendJson } from '../http.js';
import type { Handler } from '../router.js';
import { isSafeId } from '../validation.js';

export function projectsRoute(context: AppContext): Handler {
  return async ({ res }) => {
    sendJson(res, 200, { projects: await context.projects.list() });
  };
}

interface CreateProjectBody {
  name?: string;
}

export function createProjectRoute(context: AppContext): Handler {
  return async ({ req, res }) => {
    let body: CreateProjectBody;
    try {
      body = await readJson<CreateProjectBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const project = await context.projects.create(body.name ?? 'Project');
    sendJson(res, 201, { project });
  };
}

export function projectRoute(context: AppContext): Handler {
  return async ({ params, res }) => {
    if (!isSafeId(params.id)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const detail = await context.projects.get(params.id);
    if (!detail) {
      sendError(res, 404, 'not_found');
      return;
    }
    sendJson(res, 200, detail);
  };
}

interface NotesBody {
  content?: string;
}

export function saveNotesRoute(context: AppContext): Handler {
  return async ({ params, req, res }) => {
    if (!isSafeId(params.id)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    let body: NotesBody;
    try {
      body = await readJson<NotesBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const detail = await context.projects.get(params.id);
    if (!detail) {
      sendError(res, 404, 'not_found');
      return;
    }

    await context.projects.saveNotes(params.id, body.content ?? '');
    sendJson(res, 200, { ok: true });
  };
}

interface CreateConversationBody {
  title?: string;
}

export function createConversationRoute(context: AppContext): Handler {
  return async ({ params, req, res }) => {
    if (!isSafeId(params.id)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    let body: CreateConversationBody = {};
    try {
      body = await readJson<CreateConversationBody>(req);
    } catch {
      // empty body is fine
    }

    const detail = await context.projects.get(params.id);
    if (!detail) {
      sendError(res, 404, 'not_found');
      return;
    }

    const conversation = await context.projects.createConversation(params.id, body.title ?? '');
    sendJson(res, 201, { conversation });
  };
}

export function conversationRoute(context: AppContext): Handler {
  return async ({ params, res }) => {
    if (!isSafeId(params.id) || !isSafeId(params.chatId)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const conversation = await context.projects.getConversation(params.id, params.chatId);
    if (!conversation) {
      sendError(res, 404, 'not_found');
      return;
    }
    sendJson(res, 200, conversation);
  };
}

interface AppendMessageBody {
  role?: string;
  content?: string;
}

export function appendMessageRoute(context: AppContext): Handler {
  return async ({ params, req, res }) => {
    if (!isSafeId(params.id) || !isSafeId(params.chatId)) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    let body: AppendMessageBody;
    try {
      body = await readJson<AppendMessageBody>(req);
    } catch {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    if (
      (body.role !== 'user' && body.role !== 'assistant') ||
      typeof body.content !== 'string'
    ) {
      sendError(res, 400, 'error.bad_request');
      return;
    }

    const meta = await context.projects.appendMessage(
      params.id,
      params.chatId,
      body.role,
      body.content,
    );
    if (!meta) {
      sendError(res, 404, 'not_found');
      return;
    }

    sendJson(res, 200, { conversation: meta });
  };
}
