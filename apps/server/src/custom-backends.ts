import { join } from 'node:path';
import { readJsonFile, writeJsonFile, type BackendEntry } from '@ptt/backends';

export interface CustomBackendStore {
  backends: Record<string, BackendEntry>;
}

export function customBackendsPath(root: string): string {
  return join(root, '.ptt', 'backends.json');
}

export async function readCustomBackends(root: string): Promise<CustomBackendStore> {
  return (await readJsonFile<CustomBackendStore>(customBackendsPath(root))) ?? { backends: {} };
}

export async function writeCustomBackends(root: string, store: CustomBackendStore): Promise<void> {
  await writeJsonFile(customBackendsPath(root), store);
}
