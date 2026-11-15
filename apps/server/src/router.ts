import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

export type Handler = (context: Context) => Promise<void> | void;

type Method = 'GET' | 'POST';

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function match(segments: string[], path: string[]): Record<string, string> | null {
  if (segments.length !== path.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const value = path[index];
    if (segment.startsWith(':')) {
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (segment !== value) {
      return null;
    }
  }
  return params;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: splitPath(pattern), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = splitPath(url.pathname);

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = match(route.segments, path);
      if (!params) continue;
      await route.handler({ req, res, url, params });
      return true;
    }
    return false;
  }
}
