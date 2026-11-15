import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from './json-file.js';
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
  return (await readJsonFile<ModelConfigMap>(configsPath(root))) ?? {};
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

  await writeJsonFile(configsPath(root), configs);
  return record;
}
