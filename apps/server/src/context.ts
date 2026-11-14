import type { BackendLauncher, Manifest } from '@ptt/backends';
import type { JobManager } from './jobs.js';
import type { ProviderRegistry } from './providers.js';

export interface AppContext {
  registry: ProviderRegistry;
  launcher: BackendLauncher;
  jobs: JobManager;
  manifest: Manifest;
  root: string;
  modelDirs: string[];
}
