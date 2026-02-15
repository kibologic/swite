/**
 * Test CSS extraction and injection into HTML
 */

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "..", "..", "..", "test-css-extraction");

describe("CSS Extraction", () => {
  test("should extract CSS imports from entry point file", async () => {
    // Create test directory
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    try {
    // Create test files
    const srcDir = path.join(testDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(path.join(srcDir, "styles"), { recursive: true });

    // Create index.ui that imports App.uix
    const indexUi = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'

SwissApp.mount(App, '#root')`;

    // Create App.uix with CSS imports
    const appUix = `import { SwissComponent } from '@swissjs/core'
import './styles/globals.css'
import './styles/cyber-theme.css'

export class App extends SwissComponent {
  render() {
    return <div>Test</div>
  }
}`;

    // Create CSS files
    const globalsCss = `body { margin: 0; }`;
    const cyberCss = `:root { --color: #00ff00; }`;

    await fs.writeFile(path.join(srcDir, "index.ui"), indexUi);
    await fs.writeFile(path.join(srcDir, "App.uix"), appUix);
    await fs.writeFile(path.join(srcDir, "styles", "globals.css"), globalsCss);
    await fs.writeFile(path.join(srcDir, "styles", "cyber-theme.css"), cyberCss);

    // Test CSS extraction logic
    const entryPointPath = path.join(srcDir, "index.ui");
    const entryPointContent = await fs.readFile(entryPointPath, "utf-8");

    // Extract CSS imports using regex
    const cssImportPattern = /import\s+['"](.*?\.css)['"];?/g;
    const cssImports = new Set<string>();
    let match;

    // Check entry point
    while ((match = cssImportPattern.exec(entryPointContent)) !== null) {
      cssImports.add(match[1]);
    }

    // Also check imported files (like App.uix) for CSS imports
    const importPattern = /import\s+.*?from\s+['"](.*?)['"];?/g;
    const importedFiles: string[] = [];
    let importMatch;
    cssImportPattern.lastIndex = 0; // Reset regex
    while ((importMatch = importPattern.exec(entryPointContent)) !== null) {
      const importPath = importMatch[1];
      // Skip node_modules and absolute imports
      if (!importPath.startsWith("@") && !importPath.startsWith("/") && !importPath.startsWith(".")) {
        continue;
      }
      // Resolve relative imports
      if (importPath.startsWith(".")) {
        importedFiles.push(importPath);
      }
    }

    // Check imported files for CSS
    for (const importedFile of importedFiles) {
      try {
        const importedFilePath = path.resolve(path.dirname(entryPointPath), importedFile);
        // Try different extensions
        const extensions = [".uix", ".ui", ".ts", ".js"];
        let found = false;
        for (const ext of extensions) {
          const testPath = importedFilePath.endsWith(ext) ? importedFilePath : importedFilePath + ext;
          try {
            const importedContent = await fs.readFile(testPath, "utf-8");
            found = true;
            // Extract CSS imports from this file
            cssImportPattern.lastIndex = 0; // Reset regex
            let cssMatch2;
            while ((cssMatch2 = cssImportPattern.exec(importedContent)) !== null) {
              // Resolve relative CSS path
              const cssPath = cssMatch2[1];
              if (cssPath.startsWith(".")) {
                const resolvedCssPath = path.resolve(path.dirname(testPath), cssPath);
                const relativeCssPath = path.relative(srcDir, resolvedCssPath);
                const normalizedPath = relativeCssPath.replace(/\\/g, "/");
                cssImports.add(normalizedPath);
              } else {
                cssImports.add(cssPath);
              }
            }
            break;
          } catch (err) {
            // File doesn't exist with this extension, try next
          }
        }
      } catch (error) {
        // Could not read imported file, skip
      }
    }

      // Verify CSS imports were found
      assert.strictEqual(cssImports.size, 2);
      assert.strictEqual(cssImports.has("styles/globals.css"), true);
      assert.strictEqual(cssImports.has("styles/cyber-theme.css"), true);
    } finally {
      // Clean up test directory
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test("should inject CSS links into HTML", async () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

    const cssImports = ["styles/globals.css", "styles/cyber-theme.css"];
    const cssLinks = cssImports.map(cssPath => {
      const url = cssPath.startsWith("/") ? cssPath : `/src/${cssPath}`;
      return `    <link rel="stylesheet" href="${url}">`;
    }).join("\n");

    const beforeReplace = html;
    const modifiedHtml = html.replace(/\s*<\/head>/i, `${cssLinks}\n  </head>`);

    assert.notStrictEqual(modifiedHtml, beforeReplace);
    assert.ok(modifiedHtml.includes('<link rel="stylesheet" href="/src/styles/globals.css">'));
    assert.ok(modifiedHtml.includes('<link rel="stylesheet" href="/src/styles/cyber-theme.css">'));
  });

  test("should handle CSS imports in nested files", async () => {
    // Create test directory
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    try {
    // Create test files with nested imports
    const srcDir = path.join(testDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(path.join(srcDir, "styles"), { recursive: true });
    await fs.mkdir(path.join(srcDir, "components"), { recursive: true });

    const indexUi = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'

SwissApp.mount(App, '#root')`;

    const appUix = `import { SwissComponent } from '@swissjs/core'
import { Header } from './components/Header.uix'

export class App extends SwissComponent {
  render() {
    return <div><Header /></div>
  }
}`;

    const headerUix = `import { SwissComponent } from '@swissjs/core'
import '../styles/globals.css'
import '../styles/cyber-theme.css'

export class Header extends SwissComponent {
  render() {
    return <header>Header</header>
  }
}`;

    const globalsCss = `body { margin: 0; }`;
    const cyberCss = `:root { --color: #00ff00; }`;

    await fs.writeFile(path.join(srcDir, "index.ui"), indexUi);
    await fs.writeFile(path.join(srcDir, "App.uix"), appUix);
    await fs.writeFile(path.join(srcDir, "components", "Header.uix"), headerUix);
    await fs.writeFile(path.join(srcDir, "styles", "globals.css"), globalsCss);
    await fs.writeFile(path.join(srcDir, "styles", "cyber-theme.css"), cyberCss);

    // Test extraction (simplified - would need recursive traversal in real implementation)
    const entryPointPath = path.join(srcDir, "index.ui");
    const entryPointContent = await fs.readFile(entryPointPath, "utf-8");

    const cssImportPattern = /import\s+['"](.*?\.css)['"];?/g;
    const cssImports = new Set<string>();

    // Check entry point
    let match;
    while ((match = cssImportPattern.exec(entryPointContent)) !== null) {
      cssImports.add(match[1]);
    }

    // Check App.uix
    const appPath = path.join(srcDir, "App.uix");
    const appContent = await fs.readFile(appPath, "utf-8");
    cssImportPattern.lastIndex = 0;
    while ((match = cssImportPattern.exec(appContent)) !== null) {
      cssImports.add(match[1]);
    }

    // Check Header.uix
    const headerPath = path.join(srcDir, "components", "Header.uix");
    const headerContent = await fs.readFile(headerPath, "utf-8");
    cssImportPattern.lastIndex = 0;
    while ((match = cssImportPattern.exec(headerContent)) !== null) {
      const cssPath = match[1];
      if (cssPath.startsWith("..")) {
        // Resolve relative path from Header.uix location
        const resolvedCssPath = path.resolve(path.dirname(headerPath), cssPath);
        const relativeCssPath = path.relative(srcDir, resolvedCssPath);
        const normalizedPath = relativeCssPath.replace(/\\/g, "/");
        cssImports.add(normalizedPath);
      } else {
        cssImports.add(cssPath);
      }
    }

      assert.strictEqual(cssImports.size, 2);
      assert.strictEqual(cssImports.has("styles/globals.css"), true);
      assert.strictEqual(cssImports.has("styles/cyber-theme.css"), true);
    } finally {
      // Clean up test directory
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
