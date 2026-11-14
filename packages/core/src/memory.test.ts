import { describe, expect, it } from 'vitest';
import { cacheTypeBytes, estimateMemory } from './memory.js';

const info = {
  size: 4 * 1024 ** 3,
  blockCount: 32,
  embeddingLength: 4096,
  headCount: 32,
  headCountKv: 8,
  contextLength: 8192,
};

describe('cacheTypeBytes', () => {
  it('maps cache types to bytes per value', () => {
    expect(cacheTypeBytes('f16')).toBe(2);
    expect(cacheTypeBytes('f32')).toBe(4);
    expect(cacheTypeBytes('q8_0')).toBeCloseTo(1.0625);
    expect(cacheTypeBytes('f8_e4m3')).toBe(1);
    expect(cacheTypeBytes('iq4_nl')).toBeCloseTo(0.5625);
    expect(cacheTypeBytes('unknown')).toBe(2);
  });
});

describe('estimateMemory', () => {
  it('puts everything in VRAM when all layers are offloaded', () => {
    const estimate = estimateMemory(info, {
      gpuLayers: 32,
      contextSize: 4096,
      cacheTypeKBytes: 2,
      cacheTypeVBytes: 2,
    });
    expect(estimate.ramBytes).toBe(0);
    expect(estimate.kvCacheBytes).toBe(512 * 1024 ** 2);
    expect(estimate.vramBytes).toBe(4 * 1024 ** 3 + 512 * 1024 ** 2);
  });

  it('splits weights and KV cache when half the layers are offloaded', () => {
    const estimate = estimateMemory(info, {
      gpuLayers: 16,
      contextSize: 4096,
      cacheTypeKBytes: 2,
      cacheTypeVBytes: 2,
    });
    expect(estimate.ramBytes).toBe(2 * 1024 ** 3 + 256 * 1024 ** 2);
    expect(estimate.vramBytes).toBe(2 * 1024 ** 3 + 256 * 1024 ** 2);
  });

  it('keeps everything in RAM with zero GPU layers', () => {
    const estimate = estimateMemory(info, {
      gpuLayers: 0,
      contextSize: 2048,
      cacheTypeKBytes: 2,
      cacheTypeVBytes: 2,
    });
    expect(estimate.vramBytes).toBe(0);
    expect(estimate.ramBytes).toBe(4 * 1024 ** 3 + 256 * 1024 ** 2);
  });
});
