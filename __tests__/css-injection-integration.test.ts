/**
 * Integration test for CSS injection in HTML middleware
 */

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "..", "..", "..", "test-css-injection");

// Simulate the CSS extraction logic from static-files.ts
async function extractAndInjectCSS(
  configRoot: string,
  html: string
): Promise<string> {
  const entryPointPath = path.join(configRoot, "src", "index.ui");
  
  try {
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
    
    if (cssImports.size > 0) {
      const cssArray = Array.from(cssImports);
      
      // Convert relative paths to absolute URLs
      const cssLinks = cssArray.map(cssPath => {
        // If it's already absolute (starts with /), use as-is
        // Otherwise, make it relative to /src
        const url = cssPath.startsWith("/") ? cssPath : `/src/${cssPath}`;
        return `    <link rel="stylesheet" href="${url}">`;
      }).join("\n");
      
      // Inject CSS links before </head>
      const beforeReplace = html;
      html = html.replace(/\s*<\/head>/i, `${cssLinks}\n  </head>`);
      if (html === beforeReplace) {
        throw new Error("Failed to inject CSS links - </head> not found");
      }
    }
    
    return html;
  } catch (error) {
    // If entry point doesn't exist or can't be read, return HTML as-is
    return html;
  }
}

describe("CSS Injection Integration", () => {
  test("should extract and inject CSS from real project structure", async () => {
    // Create test directory structure matching pos-site
    const srcDir = path.join(testDir, "src");
    const stylesDir = path.join(srcDir, "styles");
    const publicDir = path.join(testDir, "public");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(stylesDir, { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });

    try {
      // Create index.ui (entry point)
      const indexUi = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'

SwissApp.mount(App, '#root')`;

      // Create App.uix with CSS imports (matching pos-site structure)
      const appUix = `import { SwissComponent } from '@swissjs/core'
import './styles/globals.css'
import './styles/cyber-theme.css'

export class App extends SwissComponent {
  render() {
    return <div>Test App</div>
  }
}`;

      // Create CSS files
      const globalsCss = `body { margin: 0; padding: 0; }`;
      const cyberCss = `:root { --cyber-color: #00ff00; }`;

      // Create HTML file
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

      await fs.writeFile(path.join(srcDir, "index.ui"), indexUi);
      await fs.writeFile(path.join(srcDir, "App.uix"), appUix);
      await fs.writeFile(path.join(stylesDir, "globals.css"), globalsCss);
      await fs.writeFile(path.join(stylesDir, "cyber-theme.css"), cyberCss);
      await fs.writeFile(path.join(publicDir, "index.html"), html);

      // Test the extraction and injection
      const resultHtml = await extractAndInjectCSS(testDir, html);

      // Verify CSS links were injected
      assert.ok(resultHtml.includes('<link rel="stylesheet" href="/src/styles/globals.css">'));
      assert.ok(resultHtml.includes('<link rel="stylesheet" href="/src/styles/cyber-theme.css">'));
      assert.ok(resultHtml.includes('</head>'));
      
      // Verify HTML structure is intact
      assert.ok(resultHtml.includes('<div id="root"></div>'));
      assert.ok(resultHtml.includes('<!DOCTYPE html>'));
      
      console.log("\n=== HTML WITH CSS INJECTED ===");
      console.log(resultHtml);
    } finally {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test("should handle missing entry point gracefully", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body></body>
</html>`;

    // Should not throw even if entry point doesn't exist
    const resultHtml = await extractAndInjectCSS("/nonexistent/path", html);
    
    // Should return HTML unchanged
    assert.strictEqual(resultHtml, html);
  });

  test("should handle entry point without CSS imports", async () => {
    const srcDir = path.join(testDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    try {
      const indexUi = `import { SwissApp } from '@swissjs/core'
import { App } from './App.uix'

SwissApp.mount(App, '#root')`;

      const appUix = `import { SwissComponent } from '@swissjs/core'

export class App extends SwissComponent {
  render() {
    return <div>No CSS</div>
  }
}`;

      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body></body>
</html>`;

      await fs.writeFile(path.join(srcDir, "index.ui"), indexUi);
      await fs.writeFile(path.join(srcDir, "App.uix"), appUix);

      const resultHtml = await extractAndInjectCSS(testDir, html);
      
      // Should return HTML unchanged (no CSS to inject)
      assert.strictEqual(resultHtml, html);
    } finally {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
