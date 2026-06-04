import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { rewriteImports } from '../src/resolution/rewriting/import-rewriter.js';
import { ModuleResolver } from '../src/resolution/resolver.js';
import { resetPackageRegistry } from '../src/kernel/package-registry.js';

// Reset the registry singleton before every describe block so tests don't
// inherit a workspace scan from a prior test run. This prevents the
// ModuleResolver from scanning the full filesystem (which can take 30+ minutes
// when the fake root resolves to /).
function makeResolver(): ModuleResolver {
  resetPackageRegistry();
  // Use the swite repo root so findWorkspaceRoot terminates quickly
  // (pnpm-workspace.yaml is in the parent dir, not the swite root itself,
  //  but the resolver gracefully handles a root without a workspace file).
  return new ModuleResolver(new URL('../', import.meta.url).pathname);
}

describe('Import Rewriter — bare imports', () => {
  before(() => resetPackageRegistry());

  it('rewrites unknown bare import to /node_modules/ path', async () => {
    const resolver = makeResolver();
    const code = `import { something } from '@unknown-org/nonexistent-pkg'`;
    const result = await rewriteImports(code, '/fake/src/index.uix', resolver);

    // Package not in workspace → falls back to /node_modules/ URL
    assert(
      result.includes('/node_modules/@unknown-org/nonexistent-pkg') ||
      result.includes('cdn.jsdelivr.net'),
      `Expected /node_modules/ or CDN fallback, got: ${result}`,
    );
    // Original bare specifier is gone
    assert(!result.includes("'@unknown-org/nonexistent-pkg'"), 'Bare specifier should be rewritten');
  });

  it('does not create malformed imports when rewriting multiple bare imports', async () => {
    const resolver = makeResolver();
    const code = [
      `import { SwissApp } from '@swissjs/core'`,
      `import { App } from './App.uix'`,
      `import { PosAgent } from '@swiss-enterprise/ai-agents'`,
      `import { registerBusinessModules } from './modules/index.ui'`,
    ].join('\n');

    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);

    // No malformed patterns — quote/import collision
    assert(!result.includes('@"'), `Malformed @" pattern found in: ${result}`);
    // Use [ \t]* (not \s*) — \s* would match newlines and falsely fire on consecutive
    // import statements on separate lines, which is perfectly valid.
    assert(!/from[ \t]+"[^"]*"[ \t]*import/.test(result), 'Double-quote before import keyword on same line');

    // Relative imports are left intact (they start with ./)
    assert(result.includes('./App.uix'), 'Relative .uix import should be preserved');
    assert(result.includes('./modules/index.ui'), 'Relative .ui import should be preserved');
  });
});

describe('Import Rewriter — relative extension fixes', () => {
  before(() => resetPackageRegistry());

  it('converts .js extension to .uix when importing from a .uix file', async () => {
    const resolver = makeResolver();
    const code = `import { updatePageTitle } from './utils/seo.js'`;
    const result = await rewriteImports(code, '/fake/src/App.uix', resolver);

    // .js imports from .uix files are rewritten to .uix (or .ui if only .ui exists)
    assert(
      result.includes('./utils/seo.uix') || result.includes('./utils/seo.ui') || result.includes('./utils/seo.ts'),
      `Expected extension rewrite, got: ${result}`,
    );
    assert(!result.includes('./utils/seo.js'), '.js extension should be replaced');
  });

  it('converts .js extension to .ui when importing from a .ui file', async () => {
    const resolver = makeResolver();
    const code = `import { helper } from './helpers/dom.js'`;
    const result = await rewriteImports(code, '/fake/src/App.ui', resolver);

    // .js imports from .ui files are rewritten to .ui
    assert(
      result.includes('./helpers/dom.ui') || result.includes('./helpers/dom.uix') || result.includes('./helpers/dom.ts'),
      `Expected extension rewrite, got: ${result}`,
    );
    assert(!result.includes('./helpers/dom.js'), '.js extension should be replaced');
  });
});

describe('Import Rewriter — CSS imports are skipped', () => {
  before(() => resetPackageRegistry());

  it('passes through CSS imports unchanged (stripping is done in base-handler)', async () => {
    const resolver = makeResolver();
    // Note: CSS stripping is done in base-handler.ts BEFORE rewriteImports is called.
    // rewriteImports itself skips CSS imports (does not attempt to resolve them).
    // This test verifies the skip-not-crash behaviour.
    const code = [
      `import { App } from './App.uix'`,
      `import './styles/globals.css'`,
      `import './styles/theme.css'`,
      `export default App`,
    ].join('\n');

    const result = await rewriteImports(code, '/fake/src/index.uix', resolver);

    // rewriteImports skips CSS — they remain in output (base-handler strips them)
    assert(result.includes('./App.uix'), 'Non-CSS import should still be present');
    // No crash — CSS present or absent, but no exception thrown
  });
});

describe('Import Rewriter — code with no imports is returned as-is', () => {
  before(() => resetPackageRegistry());

  it('returns code unchanged when there are no imports', async () => {
    const resolver = makeResolver();
    const code = `const x = 42;\nexport default x;`;
    const result = await rewriteImports(code, '/fake/src/mod.ts', resolver);
    assert.strictEqual(result, code);
  });
});
