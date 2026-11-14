import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@fluent/syntax';

const localesDir = fileURLToPath(new URL('../packages/i18n/locales/', import.meta.url));
const REFERENCE = 'en';

function collectKeys(source) {
  const resource = parse(source);
  const keys = new Set();

  for (const entry of resource.body) {
    if (entry.type !== 'Message') continue;
    keys.add(entry.id.name);
    for (const attribute of entry.attributes ?? []) {
      keys.add(`${entry.id.name}.${attribute.id.name}`);
    }
  }
  return keys;
}

function diff(reference, candidate) {
  return [...reference].filter((key) => !candidate.has(key)).sort();
}

const files = (await readdir(localesDir)).filter((file) => file.endsWith('.ftl'));
const catalogs = new Map();

for (const file of files) {
  const locale = file.slice(0, -4);
  catalogs.set(locale, collectKeys(await readFile(join(localesDir, file), 'utf8')));
}

if (!catalogs.has(REFERENCE)) {
  console.error(`missing reference locale: ${REFERENCE}.ftl`);
  process.exit(1);
}

const referenceKeys = catalogs.get(REFERENCE);
let failures = 0;

for (const [locale, keys] of catalogs) {
  if (locale === REFERENCE) continue;

  const missing = diff(referenceKeys, keys);
  const extra = diff(keys, referenceKeys);

  if (missing.length > 0) {
    failures++;
    console.error(`${locale}: missing ${missing.length} key(s): ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    failures++;
    console.error(`${locale}: unknown ${extra.length} key(s): ${extra.join(', ')}`);
  }
}

if (failures > 0) {
  console.error(`\ni18n check failed for ${failures} issue group(s).`);
  process.exit(1);
}

console.log(`i18n check passed: ${catalogs.size} locales, ${referenceKeys.size} keys.`);
