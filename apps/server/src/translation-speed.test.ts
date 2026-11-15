import { describe, expect, it } from 'vitest';
import { clampSpeed, concurrencyFor, speedConfig, totalContext } from './translation-speed.js';

const GB = 1024 ** 3;

describe('speedConfig', () => {
  it('limits low-memory machines to one parallel translation', () => {
    const config = speedConfig(3.7 * GB);
    expect(config.options).toEqual([{ id: 'normal', concurrency: 1 }]);
    expect(config.maxConcurrency).toBe(1);
  });

  it('allows two parallel translations with 8 GB', () => {
    const config = speedConfig(7.4 * GB);
    expect(config.options).toEqual([{ id: 'normal', concurrency: 2 }]);
    expect(config.maxConcurrency).toBe(2);
  });

  it('unlocks fast and hypersonic with a 16 GB machine (iGPU reserved RAM)', () => {
    const config = speedConfig(15.2 * GB);
    expect(config.options.map((option) => option.id)).toEqual([
      'normal',
      'fast',
      'hypersonic',
    ]);
    expect(config.maxConcurrency).toBe(5);
    expect(totalContext(config)).toBe(4096 * 5);
  });
});

describe('clampSpeed', () => {
  it('falls back to normal when the saved speed is not available', () => {
    const config = speedConfig(7.4 * GB);
    expect(clampSpeed(config, 'hypersonic')).toBe('normal');
    expect(concurrencyFor(config, 'hypersonic')).toBe(2);
  });

  it('keeps a valid speed', () => {
    const config = speedConfig(15.2 * GB);
    expect(clampSpeed(config, 'fast')).toBe('fast');
    expect(concurrencyFor(config, 'hypersonic')).toBe(5);
  });
});
