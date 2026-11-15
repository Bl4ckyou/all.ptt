export type TranslationSpeed = 'normal' | 'fast' | 'hypersonic';

export interface SpeedOption {
  id: TranslationSpeed;
  concurrency: number;
}

export interface SpeedConfig {
  memoryGb: number;
  options: SpeedOption[];
  maxConcurrency: number;
}

export const SLOT_CONTEXT = 4096;

export function totalContext(config: SpeedConfig): number {
  return SLOT_CONTEXT * config.maxConcurrency;
}

export function speedConfig(totalBytes: number): SpeedConfig {
  // iGPUs reserve RAM, so a physical 16 GB box often reports ~15 GiB.
  const memoryGb = Math.round((totalBytes / 1024 ** 3) * 10) / 10;

  if (memoryGb < 7) {
    return {
      memoryGb,
      options: [{ id: 'normal', concurrency: 1 }],
      maxConcurrency: 1,
    };
  }
  if (memoryGb < 14) {
    return {
      memoryGb,
      options: [{ id: 'normal', concurrency: 2 }],
      maxConcurrency: 2,
    };
  }
  return {
    memoryGb,
    options: [
      { id: 'normal', concurrency: 2 },
      { id: 'fast', concurrency: 3 },
      { id: 'hypersonic', concurrency: 5 },
    ],
    maxConcurrency: 5,
  };
}

export function normalSpeed(config: SpeedConfig): TranslationSpeed {
  return config.options[0]?.id ?? 'normal';
}

export function clampSpeed(config: SpeedConfig, speed: TranslationSpeed): TranslationSpeed {
  return config.options.some((option) => option.id === speed)
    ? speed
    : normalSpeed(config);
}

export function concurrencyFor(config: SpeedConfig, speed: TranslationSpeed): number {
  return (
    config.options.find((option) => option.id === clampSpeed(config, speed))?.concurrency ??
    config.maxConcurrency
  );
}
