import type { BackendLauncher, Manifest } from '@ptt/backends';
import type { JobManager } from './jobs.js';
import type { ProviderRegistry } from './providers.js';
import type { ProjectStore } from './projects.js';
import type { TranslationService } from './translation.js';
import type { TranslationManager } from './translation-backend.js';

export interface AppContext {
  registry: ProviderRegistry;
  launcher: BackendLauncher;
  jobs: JobManager;
  projects: ProjectStore;
  manifest: Manifest;
  root: string;
  modelDirs: string[];
  translation: TranslationService;
  translationManager: TranslationManager;
}
