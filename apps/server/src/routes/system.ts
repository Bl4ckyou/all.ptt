import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppContext } from '../context.js';
import { sendError, sendJson } from '../http.js';
import type { Context, Handler } from '../router.js';

const run = promisify(execFile);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isLoopback(context: Context): boolean {
  const address = context.req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function command(
  cwd: string,
  file: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(file, args, {
      cwd,
      timeout: 240_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`,
    };
  }
}

export function systemInfoRoute(_context: AppContext): Handler {
  return async ({ res }) => {
    const projectRoot = process.cwd();
    const inside = await command(projectRoot, 'git', ['rev-parse', '--is-inside-work-tree']);
    const status = await command(projectRoot, 'git', ['status', '--porcelain']);
    sendJson(res, 200, {
      git: inside.ok && inside.output.trim().endsWith('true'),
      dirty: status.ok && status.output.trim().length > 0,
    });
  };
}

export function updateProjectRoute(_context: AppContext): Handler {
  return async (request) => {
    if (!isLoopback(request)) {
      sendError(request.res, 403, 'error.forbidden');
      return;
    }

    const projectRoot = process.cwd();
    const inside = await command(projectRoot, 'git', ['rev-parse', '--is-inside-work-tree']);
    if (!inside.ok || !inside.output.trim().endsWith('true')) {
      sendJson(request.res, 400, { error: 'error.not_git' });
      return;
    }

    const status = await command(projectRoot, 'git', ['status', '--porcelain']);
    if (status.ok && status.output.trim().length > 0) {
      sendJson(request.res, 409, { error: 'error.dirty' });
      return;
    }

    const pull = await command(projectRoot, 'git', ['pull', '--ff-only']);
    if (!pull.ok) {
      sendJson(request.res, 500, { error: 'error.update', log: pull.output.slice(-4000) });
      return;
    }

    const install = await command(projectRoot, NPM, ['install']);
    if (!install.ok) {
      sendJson(request.res, 500, { error: 'error.update', log: install.output.slice(-4000) });
      return;
    }

    const build = await command(projectRoot, NPM, ['run', 'build']);
    if (!build.ok) {
      sendJson(request.res, 500, { error: 'error.update', log: build.output.slice(-4000) });
      return;
    }

    sendJson(request.res, 200, {
      ok: true,
      restartRequired: true,
      log: [pull.output, install.output, build.output].join('\n').slice(-4000),
    });
  };
}

export function restartProjectRoute(_context: AppContext): Handler {
  return (request) => {
    if (!isLoopback(request)) {
      sendError(request.res, 403, 'error.forbidden');
      return;
    }

    sendJson(request.res, 200, { ok: true });
    setTimeout(() => process.exit(75), 300);
  };
}
