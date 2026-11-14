export type {
  BackendEntry,
  GpuInfo,
  InstalledState,
  InstalledVariant,
  Manifest,
  ManifestDefaults,
  ReleaseAsset,
  ResolvedSetting,
  SelectionRule,
  SettingCategory,
  SettingDefinition,
  SettingMapping,
  SettingType,
  SettingValue,
  SettingsCatalog,
  SyncRecord,
  SyncResult,
  Target,
  Variant,
} from './types.js';
export { VARIANTS } from './types.js';

export {
  candidateTargets,
  detectTarget,
  recommendBackend,
  run,
  variantTargets,
} from './detect.js';
export { selectAsset } from './select.js';
export type { AssetSelection } from './select.js';
export { fetchReleaseByTag, fetchReleases, toAssets } from './github.js';
export type { GithubRelease } from './github.js';
export { extractArchive } from './archive.js';
export { findBinary, makeExecutable } from './find-binary.js';
export { loadManifest } from './manifest.js';
export { formatBytes, splitList, syncBackend } from './install.js';
export type { SyncOptions } from './install.js';
export {
  backendDir,
  installedStatePath,
  readInstalledState,
  readInstalledStates,
  resolveInstalledBinary,
} from './state.js';
export { scanLocalModels } from './models.js';
export type { LocalModel } from './models.js';
export { listModelDirectories } from './models.js';
export { revealPath } from './reveal.js';
export {
  buildSettingArgs,
  discoverFlags,
  parseExtraArgs,
  parseLongFlags,
  resolveSettings,
} from './settings.js';
export type { ResolvedSettingWithFlag } from './settings.js';
export {
  configsPath,
  readModelConfig,
  readModelConfigs,
  writeModelConfig,
} from './configs.js';
export type { ModelConfig, ModelConfigMap } from './configs.js';
export { BackendLauncher, findFreePort } from './launch.js';
export type { LaunchOptions, RunningBackend } from './launch.js';
