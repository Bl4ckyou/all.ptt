import { describe, expect, it } from 'vitest';
import { clampSpeed, concurrencyFor, speedConfig } from './translation-speed.js';

const GB = 1024 ** 3;

describe('speedConfig', () => {
  it('limits low-memory machines to one parallel translation', () => {
    const config = speedConfig(4 * GB);
    expect(config.options).toEqual([{ id: 'normal', concurrency: 1 }]);
    expect(config.maxConcurrency).toBe(1);
  });

  it('allows two parallel translations with 8 GB', () => {
    const config = speedConfig(8 * GB);
    expect(config.options).toEqual([{ id: 'normal', concurrency: 2 }]);
    expect(config.maxConcurrency).toBe(2);
  });

  it('unlocks fast and hypersonic with 16 GB or more', () => {
    const config = speedConfig(16 * GB);
    expect(config.options.map((option) => option.id)).toEqual([
      'normal',
      'fast',
      'hypersonic',
    ]);
    expect(config.maxConcurrency).toBe(5);
  });
});

describe('clampSpeed', () => {
  it('falls back to normal when the saved speed is not available', () => {
    const config = speedConfig(8 * GB);
    expect(clampSpeed(config, 'hypersonic')).toBe('normal');
    expect(concurrencyFor(config, 'hypersonic')).toBe(2);
  });

  it('keeps a valid speed', () => {
    const config = speedConfig(16 * GB);
    expect(clampSpeed(config, 'fast')).toBe('fast');
    expect(concurrencyFor(config, 'hypersonic')).toBe(5);
  });
});
