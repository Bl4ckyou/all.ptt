import { readFile } from 'node:fs/promises';
import type { ProviderConfig } from '@ptt/providers';

export interface AppConfig {
  host: string;
  port: number;
  providers: ProviderConfig[];
}

const defaults: AppConfig = {
  host: '127.0.0.1',
  port: 4750,
  providers: [
    { id: 'llama-cpp', kind: 'llama-cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  ],
};

async function readConfigFile(path: string): Promise<Partial<AppConfig>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Partial<AppConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const file = await readConfigFile(process.env.PTT_CONFIG ?? 'config.json');
  const env = process.env;

  return {
    host: env.PTT_HOST ?? file.host ?? defaults.host,
    port: env.PTT_PORT ? Number(env.PTT_PORT) : (file.port ?? defaults.port),
    providers: file.providers ?? defaults.providers,
  };
}
