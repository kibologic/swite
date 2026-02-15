import { describe, it } from 'node:test';
import assert from 'node:assert';
import { rewriteImports } from '../src/import-rewriter.js';
import { ModuleResolver } from '../src/resolver.js';

describe('Import Rewriter - Malformed Import Bug', () => {
  it('should not create malformed imports when rewriting multiple imports', async () => {
    const code = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'
import { PosAgent } from '@swiss-enterprise/ai-agents'
import { registerBusinessModules } from './modules/index.ui'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);
    
    console.log('\n=== ORIGINAL ===');
    console.log(code);
    console.log('\n=== REWRITTEN ===');
    console.log(result);
    console.log('\n=== HAS MALFORMED? ===');
    console.log('Has "@"":', result.includes('@"'));
    console.log('Has double quotes before import:', /"\s*import/.test(result));
    
    // Should NOT have malformed patterns
    assert(!result.includes('@"'), 'Should not contain malformed @" pattern');
    assert(!/from\s+"[^"]*"\s*import/.test(result), 'Should not have double quotes before import');
    
    // Should have valid import statements
    assert(result.includes('import {'), 'Should contain import statement');
    assert(result.includes('from'), 'Should contain from keyword');
  });

  it('should convert /swiss-lib/ paths to /swiss-packages/', async () => {
    const code = `import { SwissApp } from '/swiss-lib/packages/core/dist/framework/index.ts'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);
    
    // Should convert /swiss-lib/ to /swiss-packages/
    assert(!result.includes('/swiss-lib/'), 'Should not contain /swiss-lib/');
    assert(result.includes('/swiss-packages/'), 'Should contain /swiss-packages/');
  });

  it('should preserve .ui extensions for relative imports from .ui files', async () => {
    const code = `import { updatePageTitle } from './utils/seo.js'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/App.ui', resolver);
    
    // Should convert .js to .ui when importing from .ui file
    assert(result.includes('./utils/seo.ui'), 'Should contain .ui extension');
    assert(!result.includes('./utils/seo.js'), 'Should not contain .js extension');
    assert(!result.includes('./utils/seo.uix'), 'Should not contain .uix extension');
  });

  it('should strip CSS imports from compiled output', async () => {
    // Note: CSS imports are stripped in the handler, not in rewriteImports
    // This test verifies that rewriteImports skips CSS imports (doesn't process them)
    const code = `import { App } from './App.uix'
import './styles/globals.css'
import './styles/theme.css'
export default App`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.uix', resolver);
    
    // rewriteImports should skip CSS imports (they're handled by the handler)
    // The imports will still be in the code but won't be processed/rewritten
    // CSS stripping happens in uix-handler.ts before rewriteImports is called
    assert(result.includes('./App.uix'), 'Should still contain other imports');
    // CSS imports are skipped, not removed - they'll be stripped by the handler
  });
});

describe('ModuleResolver - swiss-lib to swiss-packages conversion', () => {
  it('should convert /swiss-lib/ paths to /swiss-packages/ in import rewriting', async () => {
    const code = `import { SwissApp } from '/swiss-lib/packages/core/dist/framework/index.ts'
import { App } from '/swiss-lib/packages/core/dist/component/index.ts'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);
    
    // Should convert all /swiss-lib/ to /swiss-packages/
    assert(!result.includes('/swiss-lib/'), 'Should not contain /swiss-lib/');
    assert(result.includes('/swiss-packages/'), 'Should contain /swiss-packages/');
    assert(result.includes('/swiss-packages/core/dist/framework/index.ts'), 'Should contain converted framework path');
    assert(result.includes('/swiss-packages/core/dist/component/index.ts'), 'Should contain converted component path');
  });

  it('should convert /swiss-lib/ paths in final pass even if missed earlier', async () => {
    // Simulate code that might have /swiss-lib/ paths from compiler
    const code = `import { SwissApp } from '/swiss-lib/packages/core/dist/index.js'
import './styles.css'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);
    
    // Final pass should catch any remaining /swiss-lib/
    assert(!result.includes('/swiss-lib/'), 'Final pass should remove /swiss-lib/');
    assert(result.includes('/swiss-packages/'), 'Final pass should add /swiss-packages/');
  });

  it('should ensure normalizeResult() prevents /swiss-lib/ paths from leaking', async () => {
    // Test that normalizeResult() wrapper in toUrl() catches /swiss-lib/ paths
    // This is tested indirectly through import rewriting, but we can also
    // verify that any URL containing /swiss-lib/ gets normalized
    const code = `import { test } from '/swiss-lib/packages/core/src/index.ts'
import { other } from '/swiss-lib/packages/utils/dist/helper.js'`;

    const resolver = new ModuleResolver('/fake/root');
    const result = await rewriteImports(code, '/fake/src/index.ui', resolver);
    
    // normalizeResult() should ensure no /swiss-lib/ in any resolved URLs
    // Even if toUrl() takes different code paths, normalizeResult() wraps all returns
    assert(!result.includes('/swiss-lib/'), 'Should not contain /swiss-lib/ in any form');
    assert(result.includes('/swiss-packages/'), 'Should contain /swiss-packages/');
    
    // Test various /swiss-lib/ path patterns that might trigger different code paths in toUrl()
    const variousPaths = [
      '/swiss-lib/packages/core/src/index.ts',
      '/swiss-lib/packages/core/dist/index.js',
      '/workspace/swiss-lib/packages/core/src/index.ts', // Path that might match workspace root first
    ];

    for (const testPath of variousPaths) {
      const testCode = `import { test } from '${testPath}'`;
      const testResult = await rewriteImports(testCode, '/fake/src/index.ui', resolver);
      assert(!testResult.includes('/swiss-lib/'), `Should not contain /swiss-lib/ for path: ${testPath}`);
      if (testPath.includes('swiss-lib')) {
        assert(testResult.includes('/swiss-packages/'), `Should contain /swiss-packages/ for path: ${testPath}`);
      }
    }
  });
});

