import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGgufFile, isGgufPath, isSafeId, isWithin } from './validation.js';

describe('isSafeId', () => {
  it('accepts alphanumeric ids with dashes', () => {
    expect(isSafeId('llama-cpp')).toBe(true);
    expect(isSafeId('ik-llama-cpp-2')).toBe(true);
  });

  it('rejects separators, dots and empty values', () => {
    expect(isSafeId('../etc')).toBe(false);
    expect(isSafeId('a/b')).toBe(false);
    expect(isSafeId('a.b')).toBe(false);
    expect(isSafeId('')).toBe(false);
    expect(isSafeId(undefined)).toBe(false);
  });
});

describe('isGgufPath', () => {
  it('accepts absolute .gguf paths', () => {
    expect(isGgufPath('/models/a.gguf')).toBe(true);
    expect(isGgufFile('a.GGUF')).toBe(true);
  });

  it('rejects relative or non-gguf paths', () => {
    expect(isGgufPath('models/a.gguf')).toBe(false);
    expect(isGgufFile('a.bin')).toBe(false);
    expect(isGgufPath(undefined)).toBe(false);
  });
});

describe('isWithin', () => {
  const base = resolve('/models/allowed');

  it('accepts the directory itself and children', () => {
    expect(isWithin('/models/allowed', base)).toBe(true);
    expect(isWithin('/models/allowed/sub', base)).toBe(true);
  });

  it('rejects sibling directories with a shared prefix', () => {
    expect(isWithin('/models/allowed-other', base)).toBe(false);
    expect(isWithin('/models', base)).toBe(false);
  });

  it('resolves .. before comparing', () => {
    expect(isWithin('/models/allowed/sub/../../etc', base)).toBe(false);
    expect(isWithin('/models/allowed/../../etc', base)).toBe(false);
    expect(isWithin('/models/allowed/sub/../other', base)).toBe(true);
  });
});
