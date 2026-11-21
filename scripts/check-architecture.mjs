import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'generated',
  'public',
  '.git',
  '.ptt',
  '.backends',
  '.sea',
]);
const modulePattern = /\.(?:[cm]?[jt]sx?)$/;
const testPattern = /\.(?:ui\.)?test\.[cm]?[jt]sx?$/;
const sourceTestPattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const duplicationMinimumNodes = 50;
const duplicationMinimumBlockNodes = 35;
const duplicationMinimumTryNodes = 18;
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, '')]));
const knownLifecycleHooks = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepare',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
  'preversion',
  'version',
  'postversion',
]);

const violations = [];
const counts = { workspaces: 0, sources: 0, scripts: 0, functions: 0, tests: 0, styles: 0, locales: 0 };

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const isInside = (path, directory) => path === directory || path.startsWith(directory + sep);

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const report = (file, line, rule, message) => {
  violations.push({ file: relative(root, file), line, rule, message });
};

async function collect(directory, matches) {
  const files = [];
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...(await collect(full, matches)));
    } else if (matches(full)) {
      files.push(full);
    }
  }
  return files;
}

async function findWorkspaces() {
  const workspaces = [];
  const visit = async (directory, depth) => {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue;
      const full = join(directory, entry.name);
      const manifest = join(full, 'package.json');
      if (await exists(manifest)) {
        workspaces.push({
          directory: full,
          manifest,
          packageJson: JSON.parse(await readFile(manifest, 'utf8')),
          browser: await exists(join(full, 'index.html')),
        });
        continue;
      }
      if (depth > 0) await visit(full, depth - 1);
    }
  };
  await visit(root, 3);
  counts.workspaces = workspaces.length;
  return workspaces;
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:[cm]?ts)$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function parseSource(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
}

function lineAt(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function moduleSpecifiers(file, text) {
  const sourceFile = parseSource(file, text);
  const found = [];
  const add = (node, literal) => {
    if (!ts.isStringLiteralLike(literal)) return;
    found.push({ specifier: literal.text, line: lineAt(sourceFile, node) });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      add(node, node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((dynamicImport || requireCall) && node.arguments.length === 1) {
        add(node, node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function loadAliases() {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return [];
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error || !read.config) return [];
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  const baseUrl = parsed.options.baseUrl ?? dirname(configPath);
  const aliases = [];
  for (const [pattern, targets] of Object.entries(parsed.options.paths ?? {})) {
    for (const target of targets) {
      aliases.push({ pattern, target, baseUrl });
    }
  }
  return aliases;
}

const aliases = loadAliases();
let workspacePackages = new Map();

function aliasMatch(specifier) {
  for (const alias of aliases) {
    const star = alias.pattern.indexOf('*');
    if (star === -1) {
      if (specifier === alias.pattern) return { alias, wildcard: '' };
      continue;
    }
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      return { alias, wildcard: specifier.slice(prefix.length, specifier.length - suffix.length) };
    }
  }
  return null;
}

function matchesSubpath(specifier, pattern) {
  const star = pattern.indexOf('*');
  if (star === -1) return specifier === pattern;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return specifier.startsWith(prefix) && specifier.endsWith(suffix);
}

function declaredDependencies(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
}

function inspectSpecifier(context, file, line, specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const target = resolve(dirname(file), specifier);
    const sharedData = isInside(target, root) && extname(target) === '.json';
    if (!isInside(target, context.directory) && !sharedData) {
      report(file, line, 'workspace-boundary', `relative import leaves ${context.name}`);
    }
    return;
  }
  if (specifier.startsWith('node:') || nodeBuiltins.has(specifier)) {
    if (context.browser) report(file, line, 'browser-node', `browser workspace imports ${specifier}`);
    return;
  }
  if (specifier.startsWith('#')) {
    const imports = Object.keys(context.packageJson.imports ?? {});
    if (!imports.some((pattern) => matchesSubpath(specifier, pattern))) {
      report(file, line, 'undeclared-dependency', `subpath import ${specifier} has no package.json imports entry`);
    }
    return;
  }
  const alias = aliasMatch(specifier);
  if (alias) {
    const target = resolve(alias.alias.baseUrl, alias.alias.target.replace('*', alias.wildcard));
    if (!isInside(target, root)) {
      report(file, line, 'workspace-boundary', `alias ${specifier} resolves outside the repository`);
    }
    return;
  }
  const name = packageName(specifier);
  if (name.startsWith('@ptt/')) {
    if (!context.declared.has(name)) {
      report(file, line, 'workspace-dependency', `undeclared workspace dependency ${name}`);
      return;
    }
    const target = workspacePackages.get(name);
    if (!target) {
      report(file, line, 'workspace-package', `unknown workspace package ${name}`);
      return;
    }
    const subpath = specifier.split('/').slice(2).join('/');
    if (subpath) {
      const exportsField = target.packageJson.exports;
      const exportKeys = typeof exportsField === 'string' ? ['.'] : Object.keys(exportsField ?? {});
      const wanted = `./${subpath}`;
      if (!exportKeys.some((key) => matchesSubpath(wanted, key))) {
        report(file, line, 'workspace-export', `${name} does not export ${wanted}`);
      }
    }
    return;
  }
  if (context.browser) {
    report(file, line, 'browser-dependency', `browser workspace imports third-party package ${name}`);
  }
  if (!context.declared.has(name)) {
    report(file, line, 'undeclared-dependency', `undeclared dependency ${name}`);
  }
}

function contextFor(workspace) {
  return {
    directory: workspace.directory,
    packageJson: workspace.packageJson,
    declared: declaredDependencies(workspace.packageJson),
    browser: workspace.browser,
    name: workspace.packageJson.name,
  };
}

async function inspectFiles(context, files) {
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const { specifier, line } of moduleSpecifiers(file, text)) {
      inspectSpecifier(context, file, line, specifier);
    }
  }
}

async function checkImports(workspaces) {
  for (const workspace of workspaces) {
    const files = await collect(
      join(workspace.directory, 'src'),
      (file) => modulePattern.test(file) && !sourceTestPattern.test(file),
    );
    counts.sources += files.length;
    await inspectFiles(contextFor(workspace), files);
  }
}

async function checkScriptImports() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = await collect(join(root, 'scripts'), (file) => modulePattern.test(file));
  counts.scripts = files.length;
  await inspectFiles(
    {
      directory: root,
      packageJson: manifest,
      declared: declaredDependencies(manifest),
      browser: false,
      name: 'scripts',
    },
    files,
  );
}

async function checkLifecycleHooks(workspaces) {
  const manifests = [join(root, 'package.json'), ...workspaces.map((workspace) => workspace.manifest)];
  for (const manifest of manifests) {
    const text = await readFile(manifest, 'utf8');
    const packageJson = JSON.parse(text);
    const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
    for (const name of scripts) {
      const implicit = name.match(/^(pre|post)(.+)$/);
      const targetsExistingScript = implicit !== null && scripts.has(implicit[2]);
      if (!targetsExistingScript && !knownLifecycleHooks.has(name)) continue;
      const index = text.indexOf(`"${name}"`);
      report(manifest, lineOf(text, Math.max(index, 0)), 'implicit-hook', `use an explicit script instead of ${name}`);
    }
  }
}

async function checkTestLocality(workspaces) {
  const files = [];
  for (const workspace of workspaces) {
    files.push(...(await collect(workspace.directory, (file) => testPattern.test(file))));
  }
  counts.tests = files.length;
  const directoryCache = new Map();
  for (const file of files) {
    const workspace = workspaces.find((candidate) => isInside(file, candidate.directory));
    if (!workspace || !isInside(file, join(workspace.directory, 'src'))) {
      report(file, 1, 'test-locality', 'tests must live inside src with the code they cover');
      continue;
    }
    const directory = dirname(file);
    if (!directoryCache.has(directory)) {
      directoryCache.set(
        directory,
        new Set((await readdir(directory)).filter((name) => modulePattern.test(name))),
      );
    }
    const siblings = directoryCache.get(directory);
    const hasSource = [...siblings].some((name) => !sourceTestPattern.test(name));
    if (!hasSource) {
      report(file, 1, 'test-locality', 'test is not co-located with source files');
    }
  }
}

function parseFtlKeys(text) {
  return new Set([...text.matchAll(/^([A-Za-z][A-Za-z0-9_-]*)\s*=/gm)].map((match) => match[1]));
}

async function checkI18n(workspaces) {
  const browserWorkspaces = workspaces.filter((candidate) => candidate.browser);
  if (browserWorkspaces.length === 0) return;
  let i18n;
  for (const workspace of workspaces) {
    if (await exists(join(workspace.directory, 'locales'))) {
      i18n = workspace;
      break;
    }
  }
  if (!i18n) {
    report(root, 1, 'i18n-source', 'no locales directory found for browser workspaces');
    return;
  }
  const localesDirectory = join(i18n.directory, 'locales');
  const localeFiles = (await readdir(localesDirectory)).filter((name) => extname(name) === '.ftl');
  counts.locales = localeFiles.length;
  if (localeFiles.length === 0) {
    report(localesDirectory, 1, 'i18n-source', 'no locale files found');
    return;
  }
  const localeKeys = new Map();
  for (const name of localeFiles) {
    localeKeys.set(name.slice(0, -4), parseFtlKeys(await readFile(join(localesDirectory, name), 'utf8')));
  }

  for (const workspace of browserWorkspaces) {
    const files = await collect(
      join(workspace.directory, 'src'),
      (file) => modulePattern.test(file) && !sourceTestPattern.test(file),
    );
    for (const file of files) {
      const sourceFile = parseSource(file, await readFile(file, 'utf8'));
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 't' &&
          node.arguments.length > 0 &&
          ts.isStringLiteralLike(node.arguments[0])
        ) {
          const key = node.arguments[0].text;
          const missing = [...localeKeys]
            .filter(([, keys]) => !keys.has(key))
            .map(([locale]) => locale);
          if (missing.length > 0) {
            report(file, lineAt(sourceFile, node), 'i18n-key', `missing key "${key}" in ${missing.join(', ')}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
}

async function checkUiStrings(workspaces) {
  const uiKeys = new Set(['text', 'title', 'aria-label', 'aria-description', 'alt']);
  const uiProperties = new Set(['textContent', 'innerText', 'innerHTML', 'title']);
  const literalText = (node) => ts.isStringLiteralLike(node) && node.text.trim().length > 0;
  for (const workspace of workspaces.filter((candidate) => candidate.browser)) {
    const files = await collect(
      join(workspace.directory, 'src'),
      (file) => modulePattern.test(file) && !sourceTestPattern.test(file),
    );
    for (const file of files) {
      const sourceFile = parseSource(file, await readFile(file, 'utf8'));
      const visit = (node) => {
        if (ts.isPropertyAssignment(node)) {
          const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : null;
          if (name && uiKeys.has(name) && literalText(node.initializer)) {
            report(file, lineAt(sourceFile, node), 'ui-string', 'user-facing string must go through t()');
          }
        }
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          uiProperties.has(node.left.name.text) &&
          literalText(node.right)
        ) {
          report(file, lineAt(sourceFile, node), 'ui-string', 'user-facing string must go through t()');
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'setAttribute' &&
          node.arguments.length >= 2 &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          uiKeys.has(node.arguments[0].text) &&
          literalText(node.arguments[1])
        ) {
          report(file, lineAt(sourceFile, node), 'ui-string', 'user-facing string must go through t()');
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
}

async function checkStyleTokens(workspaces) {
  for (const workspace of workspaces.filter((candidate) => candidate.browser)) {
    const files = await collect(join(workspace.directory, 'src'), (file) => extname(file) === '.css');
    counts.styles += files.length;
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        const match = line.match(/border-radius\s*:\s*([^;]+);/);
        if (!match) return;
        const value = match[1].trim();
        if (value.startsWith('var(') || value === '0' || value === '0px' || value === 'inherit') return;
        report(file, index + 1, 'design-token', `use a radius token instead of "${value}"`);
      });
    }
  }
}

function functionHash(node, sourceFile) {
  const parts = [];
  let count = 0;
  const visit = (child) => {
    if (child.kind === ts.SyntaxKind.ExportKeyword || child.kind === ts.SyntaxKind.DefaultKeyword) {
      return;
    }
    count += 1;
    if (ts.isIdentifier(child)) parts.push('$ID');
    else if (ts.isStringLiteralLike(child)) parts.push(`$STR:${child.text}`);
    else if (ts.isNumericLiteral(child)) parts.push(`$NUM:${child.text}`);
    else parts.push(String(child.kind));
    ts.forEachChild(child, visit);
  };
  visit(node);
  return {
    count,
    hash: createHash('sha1').update(parts.join('|')).digest('hex'),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  };
}

function collectFunctions(sourceFile, file, output) {
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const shape = functionHash(node, sourceFile);
      if (shape.count >= duplicationMinimumNodes) {
        output.push({ file, kind: 'function', ...shape });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectBlocks(sourceFile, file, output) {
  const visit = (node) => {
    const functionBody = ts.isBlock(node) && node.parent && ts.isFunctionLike(node.parent);
    const handledByTry =
      ts.isBlock(node) &&
      node.parent &&
      (ts.isTryStatement(node.parent) || ts.isCatchClause(node.parent));
    if (ts.isBlock(node) && !functionBody && !handledByTry) {
      const shape = functionHash(node, sourceFile);
      if (shape.count >= duplicationMinimumBlockNodes) {
        output.push({ file, kind: 'block', ...shape });
      }
    }
    if (ts.isTryStatement(node)) {
      const shape = functionHash(node, sourceFile);
      if (shape.count >= duplicationMinimumTryNodes) {
        output.push({ file, kind: 'try', ...shape });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

async function checkDuplication(workspaces) {
  const files = [];
  for (const workspace of workspaces) {
    files.push(
      ...(await collect(
        join(workspace.directory, 'src'),
        (file) => modulePattern.test(file) && !sourceTestPattern.test(file),
      )),
    );
  }
  files.push(...(await collect(join(root, 'scripts'), (file) => modulePattern.test(file))));
  const shapes = [];
  for (const file of files) {
    const sourceFile = parseSource(file, await readFile(file, 'utf8'));
    collectFunctions(sourceFile, file, shapes);
    collectBlocks(sourceFile, file, shapes);
  }
  counts.functions = shapes.filter((entry) => entry.kind === 'function').length;
  const groups = new Map();
  for (const entry of shapes) {
    const group = groups.get(entry.hash) ?? [];
    group.push(entry);
    groups.set(entry.hash, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const filesWithShape = new Set(group.map((entry) => entry.file));
    const functionGroup = group.every((entry) => entry.kind === 'function');
    if (functionGroup && filesWithShape.size < 2) continue;
    group.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const first = group[0];
    for (const duplicate of group.slice(1)) {
      report(
        duplicate.file,
        duplicate.line,
        'duplication',
        `structurally duplicates ${relative(root, first.file)}:${first.line} (${duplicate.kind}, ${duplicate.count} nodes)`,
      );
    }
  }
}

const workspaces = await findWorkspaces();
workspacePackages = new Map(workspaces.map((workspace) => [workspace.packageJson.name, workspace]));
await checkImports(workspaces);
await checkScriptImports();
await checkLifecycleHooks(workspaces);
await checkTestLocality(workspaces);
await checkI18n(workspaces);
await checkUiStrings(workspaces);
await checkStyleTokens(workspaces);
await checkDuplication(workspaces);

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  }
  console.error(`\nArchitecture check failed: ${violations.length} violation(s).`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed: ${counts.workspaces} workspaces, ${counts.sources} sources, ` +
      `${counts.scripts} scripts, ${counts.functions} functions, ${counts.tests} tests, ` +
      `${counts.styles} styles, ${counts.locales} locales.`,
  );
}
