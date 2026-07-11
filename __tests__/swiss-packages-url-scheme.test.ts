import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toUrl } from '../src/resolution/url-resolver.js';
import { resolveFilePath } from '../src/resolution/path/file-path-resolver.js';
import { findMonorepoPackageDir } from '../src/kernel/monorepo-package-registry.js';

// swiss-lib was once nested as <monorepo>/packages/<pkg>; it has since been
// flattened to directly-named top-level directories (runtime/, compiler/,
// plugins/file-router/) whose directory name does not always match the
// package's unscoped name segment (@swissjs/core lives in runtime/). These
// tests build a throwaway monorepo with that exact (current, real) shape and
// assert both directions of the /swiss-packages/ URL scheme agree with each
// other -- toUrl() encodes, resolveFilePath() must decode back to the same
// absolute path.

async function makeFakeMonorepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swiss-lib-fake-'));
  const appRoot = path.join(root, 'my-app');
  const monorepoRoot = path.join(root, 'swiss-lib');

  await fs.mkdir(appRoot, { recursive: true });
  await fs.mkdir(path.join(monorepoRoot, 'runtime', 'src'), { recursive: true });
  await fs.mkdir(path.join(monorepoRoot, 'plugins', 'file-router', 'src'), { recursive: true });

  // findSwissLibMonorepo() (package-finder.ts) requires the sibling repo
  // itself to have a root package.json to be recognized at all -- matches
  // the real swiss-lib, which is a pnpm workspace root.
  await fs.writeFile(
    path.join(monorepoRoot, 'package.json'),
    JSON.stringify({ name: 'swiss-lib-workspace-root', private: true }),
  );

  await fs.writeFile(
    path.join(monorepoRoot, 'runtime', 'package.json'),
    JSON.stringify({ name: '@swissjs/core', version: '1.0.0' }),
  );
  await fs.writeFile(path.join(monorepoRoot, 'runtime', 'src', 'index.ts'), 'export {};');

  await fs.writeFile(
    path.join(monorepoRoot, 'plugins', 'file-router', 'package.json'),
    JSON.stringify({ name: '@swissjs/plugin-file-router', version: '1.0.0' }),
  );
  await fs.writeFile(
    path.join(monorepoRoot, 'plugins', 'file-router', 'src', 'index.ts'),
    'export {};',
  );

  return root;
}

const tmpDirs: string[] = [];

async function setup() {
  const root = await makeFakeMonorepo();
  tmpDirs.push(root);
  return { root, appRoot: path.join(root, 'my-app'), monorepoRoot: path.join(root, 'swiss-lib') };
}

after(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('monorepo-package-registry — findMonorepoPackageDir', () => {
  it('finds a package whose directory name does not match its unscoped name (@swissjs/core -> runtime/)', async () => {
    const { monorepoRoot } = await setup();
    const dir = await findMonorepoPackageDir(monorepoRoot, '@swissjs/core', true);
    assert.strictEqual(dir, path.join(monorepoRoot, 'runtime'));
  });

  it('finds a package nested one level under a grouping directory (plugins/file-router)', async () => {
    const { monorepoRoot } = await setup();
    const dir = await findMonorepoPackageDir(monorepoRoot, '@swissjs/plugin-file-router', true);
    assert.strictEqual(dir, path.join(monorepoRoot, 'plugins', 'file-router'));
  });

  it('returns null for an unknown package', async () => {
    const { monorepoRoot } = await setup();
    const dir = await findMonorepoPackageDir(monorepoRoot, '@swissjs/does-not-exist', true);
    assert.strictEqual(dir, null);
  });
});

describe('/swiss-packages/ URL scheme — encode/decode round-trip', () => {
  it('toUrl() encodes a file under a flattened package dir, resolveFilePath() decodes it back to the same absolute path', async () => {
    const { appRoot, monorepoRoot } = await setup();
    const absoluteFile = path.join(monorepoRoot, 'runtime', 'src', 'index.ts');

    const url = await toUrl(absoluteFile, {
      root: appRoot,
      getWorkspaceRoot: async () => null,
      fileExists: async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      },
    });

    assert.strictEqual(url, '/swiss-packages/runtime/src/index.ts');

    const resolved = await resolveFilePath(url, appRoot, null);
    assert.strictEqual(resolved, absoluteFile);
  });

  it('round-trips a nested grouping-directory package (plugins/file-router)', async () => {
    const { appRoot, monorepoRoot } = await setup();
    const absoluteFile = path.join(monorepoRoot, 'plugins', 'file-router', 'src', 'index.ts');

    const url = await toUrl(absoluteFile, {
      root: appRoot,
      getWorkspaceRoot: async () => null,
      fileExists: async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      },
    });

    assert.strictEqual(url, '/swiss-packages/plugins/file-router/src/index.ts');

    const resolved = await resolveFilePath(url, appRoot, null);
    assert.strictEqual(resolved, absoluteFile);
  });
});
