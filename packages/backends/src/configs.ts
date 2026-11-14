import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SettingValue } from './types.js';

export interface ModelConfig {
  settings: Record<string, SettingValue>;
  extraArgs: string;
  updatedAt: string;
}

export type ModelConfigMap = Record<string, ModelConfig>;

export function configsPath(root: string): string {
  return join(root, '.ptt', 'model-configs.json');
}

export async function readModelConfigs(root: string): Promise<ModelConfigMap> {
  try {
    return JSON.parse(await readFile(configsPath(root), 'utf8')) as ModelConfigMap;
  } catch {
    return {};
  }
}

export async function readModelConfig(root: string, path: string): Promise<ModelConfig | null> {
  const configs = await readModelConfigs(root);
  return configs[path] ?? null;
}

export async function writeModelConfig(
  root: string,
  path: string,
  config: Omit<ModelConfig, 'updatedAt'>,
): Promise<ModelConfig> {
  const configs = await readModelConfigs(root);
  const record: ModelConfig = { ...config, updatedAt: new Date().toISOString() };
  configs[path] = record;

  await mkdir(dirname(configsPath(root)), { recursive: true });
  await writeFile(configsPath(root), `${JSON.stringify(configs, null, 2)}\n`);
  return record;
}
