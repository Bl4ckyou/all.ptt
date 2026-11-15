import { isAbsolute, resolve, sep } from 'node:path';

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

export function isGgufFile(value: unknown): value is string {
  return typeof value === 'string' && value.toLowerCase().endsWith('.gguf');
}

export function isGgufPath(value: unknown): value is string {
  return isGgufFile(value) && isAbsolute(value);
}

export function isWithin(directory: string, base: string): boolean {
  const target = resolve(directory);
  const root = resolve(base);
  return target === root || target.startsWith(`${root}${sep}`);
}
