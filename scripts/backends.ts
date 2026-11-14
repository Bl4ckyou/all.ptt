import {
  VARIANTS,
  detectTarget,
  formatBytes,
  loadManifest,
  recommendBackend,
  splitList,
  syncBackend,
} from '@ptt/backends';

const manifest = loadManifest();

let command = 'info';
let commandSet = false;
let variantOption: string | undefined;
let targetOverride: string | undefined;
let version: string | undefined;
let force = false;
let dryRun = false;
const ids: string[] = [];

const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === '--variant') {
    variantOption = argv[++index];
  } else if (arg === '--target') {
    targetOverride = argv[++index];
  } else if (arg === '--version') {
    version = argv[++index];
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

const variants = splitList(variantOption);
const invalidVariant = variants.find((variant) => !(VARIANTS as readonly string[]).includes(variant));
if (invalidVariant) {
  console.error(`unknown variant: ${invalidVariant} (expected: ${VARIANTS.join(', ')})`);
  process.exit(1);
}

const target = detectTarget();
if (targetOverride) target.targets = [targetOverride];
const token = process.env.GITHUB_TOKEN;
const root = process.cwd();

function printTarget(): void {
  const gpu = target.gpu;
  const name = gpu.name ? ` (${gpu.name})` : '';
  const cuda = gpu.cuda ? ` cuda ${gpu.cuda}` : '';
  console.log(`platform: ${target.os}/${target.arch}`);
  console.log(`cpu: ${target.cpu ?? 'n/a'}`);
  console.log(`gpu: ${gpu.vendor}${name}${cuda}`);
  console.log(`targets: ${target.targets.join(' > ') || '(none)'}`);
  console.log(`recommended: ${recommendBackend(target, manifest.defaults)}`);
}

async function sync(mode: 'install' | 'update', selectedIds: string[]): Promise<void> {
  printTarget();
  for (const id of selectedIds) {
    const backend = manifest.backends[id];
    if (!backend) {
      console.error(`\n${id}: unknown backend`);
      process.exitCode = 1;
      continue;
    }

    console.log(`\n${id}:`);
    try {
      const result = await syncBackend({
        id,
        backend,
        target,
        root,
        variants,
        mode,
        version,
        force,
        dryRun,
        token,
      });

      if (result.skipped) {
        console.log(`  nothing to do: ${result.reason}`);
        continue;
      }
      for (const record of result.records) {
        if (record.skipped) {
          console.log(`  ${record.variant}: up to date (${record.tag})`);
        } else if (record.dryRun) {
          console.log(
            `  ${record.variant}: would install ${record.asset} [${record.tag}] -> ${record.target} (${formatBytes(record.size)})`,
          );
        } else {
          console.log(`  ${record.variant}: installed ${record.asset} [${record.tag}] -> ${record.target}`);
          console.log(`    binary: ${record.binary}`);
        }
      }
    } catch (error) {
      console.error(`  failed: ${(error as Error).message}`);
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
  const selected = ids.length > 0 ? ids : [recommendBackend(target, manifest.defaults)];
  await sync('install', selected);
} else if (command === 'update') {
  await sync('update', ids.length > 0 ? ids : Object.keys(manifest.backends));
} else {
  console.error(
    'usage: tsx scripts/backends.ts <info|list|install|update> [ids...] [--variant <auto|cpu|vulkan|cuda|rocm|metal>] [--version <tag>] [--target <target>] [--force] [--dry-run]',
  );
  process.exitCode = 1;
}
