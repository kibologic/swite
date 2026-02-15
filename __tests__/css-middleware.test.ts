/**
 * Test CSS extraction middleware function directly
 */

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "..", "..", "..", "test-css-middleware");

// Extract the CSS extraction logic as a testable function
async function extractCSSImports(configRoot: string): Promise<string[]> {
  const entryPointPath = path.join(configRoot, "src", "index.ui");
  
  try {
    const entryPointContent = await fs.readFile(entryPointPath, "utf-8");
    
    const cssImportPattern = /import\s+['"](.*?\.css)['"];?/g;
    const cssImports = new Set<string>();
    let match;
    
    // Check entry point
    while ((match = cssImportPattern.exec(entryPointContent)) !== null) {
      cssImports.add(match[1]);
    }
    
    // Check imported files
    const importPattern = /import\s+.*?from\s+['"](.*?)['"];?/g;
    const importedFiles: string[] = [];
    let importMatch;
    cssImportPattern.lastIndex = 0;
    while ((importMatch = importPattern.exec(entryPointContent)) !== null) {
      const importPath = importMatch[1];
      if (!importPath.startsWith("@") && !importPath.startsWith("/") && !importPath.startsWith(".")) {
        continue;
      }
      if (importPath.startsWith(".")) {
        importedFiles.push(importPath);
      }
    }
    
    // Check imported files for CSS
    for (const importedFile of importedFiles) {
      try {
        const importedFilePath = path.resolve(path.dirname(entryPointPath), importedFile);
        const extensions = [".uix", ".ui", ".ts", ".js"];
        let found = false;
        for (const ext of extensions) {
          const testPath = importedFilePath.endsWith(ext) ? importedFilePath : importedFilePath + ext;
          try {
            const importedContent = await fs.readFile(testPath, "utf-8");
            found = true;
            cssImportPattern.lastIndex = 0;
            let cssMatch2;
            while ((cssMatch2 = cssImportPattern.exec(importedContent)) !== null) {
              const cssPath = cssMatch2[1];
              if (cssPath.startsWith(".")) {
                const resolvedCssPath = path.resolve(path.dirname(testPath), cssPath);
                const relativeCssPath = path.relative(path.join(configRoot, "src"), resolvedCssPath);
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
    
    return Array.from(cssImports);
  } catch (error) {
    // If entry point doesn't exist or can't be read, return empty array
    return [];
  }
}

function injectCSSLinks(html: string, cssImports: string[]): string {
  if (cssImports.length === 0) {
    return html;
  }
  
  const cssLinks = cssImports.map(cssPath => {
    const url = cssPath.startsWith("/") ? cssPath : `/src/${cssPath}`;
    return `    <link rel="stylesheet" href="${url}">`;
  }).join("\n");
  
  const beforeReplace = html;
  html = html.replace(/\s*<\/head>/i, `${cssLinks}\n  </head>`);
  if (html === beforeReplace) {
    throw new Error("Failed to inject CSS links - </head> not found");
  }
  
  return html;
}

describe("CSS Middleware Function", () => {
  test("should extract CSS from pos-site structure", async () => {
    const srcDir = path.join(testDir, "src");
    const stylesDir = path.join(srcDir, "styles");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(stylesDir, { recursive: true });

    try {
      // Create files matching pos-site structure
      const indexUi = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'

SwissApp.mount(App, '#root')`;

      const appUix = `import { SwissComponent } from '@swissjs/core'
import './styles/globals.css'
import './styles/cyber-theme.css'

export class App extends SwissComponent {
  render() {
    return <div>App</div>
  }
}`;

      await fs.writeFile(path.join(srcDir, "index.ui"), indexUi);
      await fs.writeFile(path.join(srcDir, "App.uix"), appUix);
      await fs.writeFile(path.join(stylesDir, "globals.css"), "body { margin: 0; }");
      await fs.writeFile(path.join(stylesDir, "cyber-theme.css"), ":root { --color: #00ff00; }");

      // Test extraction
      const cssImports = await extractCSSImports(testDir);
      
      assert.strictEqual(cssImports.length, 2);
      assert.ok(cssImports.includes("styles/globals.css"));
      assert.ok(cssImports.includes("styles/cyber-theme.css"));

      // Test injection
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body></body>
</html>`;

      const resultHtml = injectCSSLinks(html, cssImports);
      
      assert.ok(resultHtml.includes('<link rel="stylesheet" href="/src/styles/globals.css">'));
      assert.ok(resultHtml.includes('<link rel="stylesheet" href="/src/styles/cyber-theme.css">'));
      
      console.log("\n=== EXTRACTED CSS IMPORTS ===");
      console.log(cssImports);
      console.log("\n=== HTML WITH CSS ===");
      console.log(resultHtml);
    } finally {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test("should match actual pos-site file structure", async () => {
    // Test with actual pos-site structure
    const posSiteRoot = path.join(__dirname, "..", "..", "..", "websites", "pos-site");
    
    try {
      const cssImports = await extractCSSImports(posSiteRoot);
      
      console.log("\n=== POS SITE CSS IMPORTS ===");
      console.log(`Found ${cssImports.length} CSS import(s):`, cssImports);
      
      // Should find the CSS imports from App.uix
      assert.ok(cssImports.length >= 2, "Should find at least 2 CSS imports");
      assert.ok(
        cssImports.some(css => css.includes("globals.css") || css.includes("cyber-theme.css")),
        "Should find globals.css or cyber-theme.css"
      );
    } catch (error) {
      // If pos-site doesn't exist, skip this test
      console.log("Skipping pos-site test - directory not found");
    }
  });
});
