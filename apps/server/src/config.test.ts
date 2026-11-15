import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const originalPort = process.env.PTT_PORT;

afterEach(() => {
  if (originalPort === undefined) delete process.env.PTT_PORT;
  else process.env.PTT_PORT = originalPort;
});

describe('loadConfig', () => {
  it('accepts a valid PTT_PORT', async () => {
    process.env.PTT_PORT = '4800';
    await expect(loadConfig()).resolves.toMatchObject({ port: 4800 });
  });

  it('rejects a non-numeric PTT_PORT', async () => {
    process.env.PTT_PORT = 'not-a-port';
    await expect(loadConfig()).rejects.toThrow('invalid port');
  });

  it('rejects an out-of-range PTT_PORT', async () => {
    process.env.PTT_PORT = '70000';
    await expect(loadConfig()).rejects.toThrow('invalid port');
  });
});
