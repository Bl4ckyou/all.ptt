import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearModelScanCache,
  scanLocalFiles,
  setModelScanIndex,
} from './models.js';

const originalHub = process.env.HF_HUB_CACHE;
const directories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-scan-'));
  directories.push(directory);
  return directory;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function text(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
}

function entry(key: string, type: number, value: Buffer): Buffer {
  return Buffer.concat([text(key), u32(type), value]);
}

function gguf(withTokenizer: boolean): Buffer {
  const entries = [
    entry('general.architecture', 8, text('llama')),
    entry('general.name', 8, text('Test model')),
    ...(withTokenizer
      ? [entry('tokenizer.chat_template', 8, text('{{ messages }}'))]
      : []),
  ];
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(0),
    u64(entries.length),
    ...entries,
  ]);
}

afterEach(async () => {
  if (originalHub === undefined) delete process.env.HF_HUB_CACHE;
  else process.env.HF_HUB_CACHE = originalHub;
  setModelScanIndex(join(process.cwd(), '.ptt', 'model-scan.json'));
  clearModelScanCache();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('scanLocalFiles', () => {
  it.skipIf(process.platform === 'win32')(
    'follows symlinked model directories and indexes ignored GGUFs',
    async () => {
      const root = await workspace();
      process.env.HF_HUB_CACHE = join(root, 'hub');
      await mkdir(process.env.HF_HUB_CACHE, { recursive: true });

      const models = join(root, 'models');
      await mkdir(models, { recursive: true });
      await writeFile(join(models, 'good-Q4_K_M.gguf'), gguf(true));
      await writeFile(join(models, 'diffusion.gguf'), gguf(false));

      const link = join(root, 'link');
      await symlink(models, link);

      const index = join(root, 'scan.json');
      setModelScanIndex(index);
      clearModelScanCache();

      const files = await scanLocalFiles([link]);
      expect(files.models.map((model) => model.name)).toContain('good-Q4_K_M');

      await new Promise((resolve) => setTimeout(resolve, 350));
      const stored = JSON.parse(await readFile(index, 'utf8')) as Record<
        string,
        { ignored?: boolean }
      >;
      expect(Object.values(stored).some((entry) => entry.ignored)).toBe(true);
    },
  );
});
