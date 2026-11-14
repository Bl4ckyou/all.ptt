import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTarget } from './backends/detect.mjs';
import { formatBytes, installBackend } from './backends/install.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'backends.json'), 'utf8'));

let command = 'info';
let commandSet = false;
const ids = [];
let version;
let force = false;
let dryRun = false;
let targetOverride;

const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === '--version') {
    version = argv[++index];
  } else if (arg === '--target') {
    targetOverride = argv[++index];
  } else if (arg === '--force') {
    force = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (!commandSet) {
    command = arg;
    commandSet = true;
  } else {
    ids.push(arg);
  }
}

const target = detectTarget();
if (targetOverride) target.targets = [targetOverride];
const token = process.env.GITHUB_TOKEN;

function printTarget() {
  const gpu = target.gpu;
  const name = gpu.name ? ` (${gpu.name})` : '';
  const cuda = gpu.cuda ? ` cuda ${gpu.cuda}` : '';
  console.log(`platform: ${target.os}/${target.arch}`);
  console.log(`cpu: ${target.cpu ?? 'n/a'}`);
  console.log(`gpu: ${gpu.vendor}${name}${cuda}`);
  console.log(`targets: ${target.targets.join(' > ') || '(none)'}`);
}

async function install() {
  const selected = ids.length > 0 ? ids : Object.keys(manifest.backends);
  printTarget();

  for (const id of selected) {
    const backend = manifest.backends[id];
    if (!backend) {
      console.error(`\n${id}: unknown backend`);
      process.exitCode = 1;
      continue;
    }

    console.log(`\n${id}:`);
    try {
      const record = await installBackend({ id, backend, target, root, version, force, dryRun, token });
      if (record.skipped) {
        console.log(`  up to date: ${record.tag}`);
      } else if (record.dryRun) {
        console.log(`  would install ${record.asset} [${record.tag}] -> ${record.target} (${formatBytes(record.size)})`);
      } else {
        console.log(`  installed ${record.asset} [${record.tag}] -> ${record.target}`);
        console.log(`  binary: ${record.binary}`);
      }
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

if (command === 'info') {
  printTarget();
} else if (command === 'list') {
  for (const [id, backend] of Object.entries(manifest.backends)) {
    console.log(`${id}\t${backend.label}\t${backend.repo}`);
  }
} else if (command === 'install') {
  await install();
} else {
  console.error('usage: node scripts/backends.mjs <info|list|install> [ids...] [--version <tag>] [--target <target>] [--force] [--dry-run]');
  process.exitCode = 1;
}
