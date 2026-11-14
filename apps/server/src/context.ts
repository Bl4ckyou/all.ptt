import type { BackendLauncher, Manifest } from '@ptt/backends';
import type { ProviderRegistry } from './providers.js';

export interface AppContext {
  registry: ProviderRegistry;
  launcher: BackendLauncher;
  manifest: Manifest;
  root: string;
  modelDirs: string[];
}
