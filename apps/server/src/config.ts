import { readFile } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import type { ProviderConfig } from '@ptt/providers';

export interface TranslationOptions {
  providerId: string;
  model: string;
}

export interface AppConfig {
  host: string;
  port: number;
  providers: ProviderConfig[];
  backendRoot: string;
  modelDirs: string[];
  translation?: TranslationOptions;
}

const defaults: AppConfig = {
  host: '127.0.0.1',
  port: 4750,
  providers: [
    { id: 'llama-cpp', kind: 'llama-cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  ],
  backendRoot: process.cwd(),
  modelDirs: [],
};

function parsePort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${String(value)}`);
  }
  return port;
}

async function readConfigFile(path: string): Promise<Partial<AppConfig>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Partial<AppConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function readTranslation(
  file: Partial<AppConfig>,
  env: NodeJS.ProcessEnv,
): TranslationOptions | undefined {
  const providerId = env.PTT_TRANSLATION_PROVIDER ?? file.translation?.providerId;
  const model = env.PTT_TRANSLATION_MODEL ?? file.translation?.model;
  if (!providerId && !model) return undefined;
  if (!providerId || !model) {
    throw new Error('translation requires both providerId and model');
  }
  return { providerId, model };
}

export async function loadConfig(): Promise<AppConfig> {
  const file = await readConfigFile(process.env.PTT_CONFIG ?? 'config.json');
  const env = process.env;

  return {
    host: env.PTT_HOST ?? file.host ?? defaults.host,
    port: parsePort(env.PTT_PORT ?? file.port ?? defaults.port),
    providers: file.providers ?? defaults.providers,
    backendRoot: resolve(env.PTT_BACKEND_ROOT ?? file.backendRoot ?? defaults.backendRoot),
    modelDirs: env.PTT_MODEL_DIRS
      ? env.PTT_MODEL_DIRS.split(delimiter).filter(Boolean)
      : (file.modelDirs ?? defaults.modelDirs),
    translation: readTranslation(file, env),
  };
}
