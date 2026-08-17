import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// S-05 / TD-02: swite/node_modules was historically a symlink to
// swiss-lib/node_modules, which only carries esbuild in its pnpm store
// (not hoisted to a top-level `esbuild` entry) and pins the wrong major
// version (0.25.x) versus what swite's package.json actually requires
// (^0.28.1, used unconditionally by build-engine/builder.ts). The result
// was a hard crash on startup: `Cannot find package 'esbuild'`.
//
// swite now installs its own real node_modules (pnpm overrides link
// @swissjs/core and @swissjs/compiler to the local swiss-lib packages so
// this doesn't regress onto the published registry versions), which gives
// it an independently resolvable, correct-major esbuild.
//
// This test would fail on the pre-fix state: with node_modules symlinked
// to swiss-lib's tree, `require.resolve('esbuild', ...)` from swite's own
// package root either throws MODULE_NOT_FOUND or resolves an esbuild
// whose major version does not satisfy swite's own declared range.
describe('esbuild resolution (S-05 / TD-02)', () => {
  it('resolves esbuild from swite\'s own package root', () => {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const resolved = require.resolve('esbuild');
    assert.ok(resolved.length > 0, 'esbuild must be resolvable from swite root');
  });

  it('resolves an esbuild version satisfying the declared ^0.28.1 range', () => {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const esbuildPkgPath = require.resolve('esbuild/package.json');
    const esbuildPkg = require(esbuildPkgPath) as { version: string };
    const [major, minor] = esbuildPkg.version.split('.').map(Number);
    assert.ok(
      major > 0 || minor >= 28,
      `esbuild@${esbuildPkg.version} does not satisfy swite's declared ^0.28.1 requirement`,
    );
  });

  it('the build-engine builder module itself resolves esbuild at import time', async () => {
    // Import the compiled builder (dist) the same way the running dev server
    // does -- this is the exact module whose bare `import 'esbuild'` crashed
    // with ERR_MODULE_NOT_FOUND before this fix.
    const distBuilder = path.join(process.cwd(), 'dist', 'build-engine', 'builder.js');
    const url = 'file://' + distBuilder.replace(/\\/g, '/');
    await assert.doesNotReject(
      async () => { await import(url); },
      'importing build-engine/builder.js must not throw ERR_MODULE_NOT_FOUND for esbuild',
    );
  });
});
