/*
 * Import Rewriter for SWITE
 *
 * SIMPLIFIED APPROACH:
 * - es-module-lexer ONLY returns static import specifiers (string literals)
 * - If es-module-lexer found it, it's ALWAYS an import, never a variable
 * - Trust the lexer and rewrite everything it finds (except relative imports)
 * - Let the resolver handle resolution, fallback to CDN if needed
 */

import { init, parse } from "es-module-lexer";
import { ModuleResolver } from "./resolver.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";

export async function rewriteImports(
  code: string,
  importer: string,
  resolver: ModuleResolver,
): Promise<string> {
  await init;

  try {
    const [imports] = parse(code);

    console.log(
      `[SWITE] import-rewriter: Found ${imports.length} import(s) in ${importer}`,
    );
    if (imports.length === 0) {
      console.log(
        `[SWITE] import-rewriter: No imports found, returning original code`,
      );
      return code;
    }

    let rewritten = code;
    let offset = 0;

    for (const imp of imports) {
      let { s: start, e: end } = imp;
      const specifier = code.slice(start, end);
      console.log(`[SWITE] import-rewriter: Processing import: "${specifier}"`);

      // Skip CSS imports - these should be handled as static assets, not modules
      if (specifier.includes(".css")) {
        console.log(`[SWITE] import-rewriter: Skipping CSS import: "${specifier}"`);
        continue;
      }

      // Extract quote character and actual specifier
      const firstChar = specifier[0];
      const lastChar = specifier[specifier.length - 1];
      const hasQuotes =
        (firstChar === '"' || firstChar === "'") && firstChar === lastChar;

      let actualSpecifier: string;
      let quoteChar: string | null = null;

      if (hasQuotes) {
        actualSpecifier = specifier.slice(1, -1);
        quoteChar = firstChar;
      } else {
        // Unquoted - check surrounding code for quotes
        const codeBefore = code.slice(Math.max(0, start - 1), start);
        const codeAfter = code.slice(end, Math.min(code.length, end + 1));
        if (
          (codeBefore === '"' || codeBefore === "'") &&
          codeBefore === codeAfter
        ) {
          quoteChar = codeBefore;
          actualSpecifier = specifier;
          start = start - 1;
          end = end + 1;
        } else {
          // No quotes found - this shouldn't happen with es-module-lexer for static imports
          // But if it does, try to find the quoted version in the code
          const escapedSpecifier = specifier.replace(
            /[.*+?^${}()|[\]\\-]/g,
            "\\$&",
          );
          const quotedPattern = new RegExp(`(['"])${escapedSpecifier}\\1`);
          const match = quotedPattern.exec(code);
          if (match) {
            quoteChar = match[1];
            actualSpecifier = match[0].slice(1, -1);
            start = match.index!;
            end = match.index! + match[0].length;
          } else {
            // Can't find quotes, skip this import (shouldn't happen)
            console.warn(
              `[SWITE] import-rewriter: Could not find quotes for specifier: ${specifier}`,
            );
            continue;
          }
        }
      }

      // CRITICAL: Fix compiler bug where .uix/.ui imports are changed to .js
      // In dev mode, we need to preserve correct extensions for relative imports
      // Context-aware: SWISS packages use .ts, app files use .uix/.ui
      if (actualSpecifier.startsWith(".") && actualSpecifier.endsWith(".js") && !actualSpecifier.includes("node_modules")) {
        console.log(
          `[SWITE] import-rewriter: 🔧 Found relative .js import that needs fixing: "${actualSpecifier}"`,
        );
        
        // Determine correct extension based on context
        // IMPORTANT: Check /lib/ and /swiss-packages/ FIRST before checking file extension
        // Normalize path separators for Windows compatibility
        const normalizedImporter = importer.replace(/\\/g, "/");
        const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
        const isLibPath = normalizedImporter.includes("/lib/");
        const isUixFile = normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");
        
        let newExtension: string;
        if (isSwissPackage) {
          // SWISS packages use .ts files
          newExtension = ".ts";
        } else if (isLibPath) {
          // /lib/ paths can have .ts, .ui, or .uix files
          // Default to .ts for /lib/ paths (most common - types, core logic, etc.)
          // Handlers will try .ui/.uix if .ts doesn't exist
          newExtension = ".ts";
          console.log(
            `[SWITE] import-rewriter: 🎯 /lib/ path detected - using .ts extension (importer: ${importer}, specifier: ${actualSpecifier})`,
          );
        } else if (isUixFile) {
          // If importing from a .uix/.ui file, try to preserve the original extension
          // Check if the file exists with .ui extension first, then .uix
          const baseSpecifier = actualSpecifier.slice(0, -3); // Remove .js
          
          // Get the directory of the CURRENT file being rewritten (not project root)
          const currentDir = path.dirname(importer);
          
          // Clean the import path - remove leading './' if present
          const cleanImportPath = baseSpecifier.startsWith('./') 
            ? baseSpecifier.slice(2) 
            : baseSpecifier.startsWith('../')
            ? baseSpecifier
            : baseSpecifier;
          
          // Construct the absolute path to the potential .ui dependency
          const absoluteUiPath = path.resolve(currentDir, cleanImportPath + '.ui');
          const absoluteUixPath = path.resolve(currentDir, cleanImportPath + '.uix');
          
          console.log(`[SWITE] import-rewriter: Checking for .ui/.uix files: baseSpecifier="${baseSpecifier}", currentDir="${currentDir}", cleanImportPath="${cleanImportPath}"`);
          console.log(`[SWITE] import-rewriter: Checking paths: ${absoluteUiPath}, ${absoluteUixPath}`);
          
          // Check which file exists (prefer .ui since that's what source code uses)
          try {
            await fs.access(absoluteUiPath);
            newExtension = ".ui";
            console.log(`[SWITE] import-rewriter: ✅ Found .ui file: ${absoluteUiPath}`);
          } catch (err) {
            console.log(`[SWITE] import-rewriter: ❌ .ui file not found: ${absoluteUiPath} (${err instanceof Error ? err.message : String(err)})`);
            try {
              await fs.access(absoluteUixPath);
              newExtension = ".uix";
              console.log(`[SWITE] import-rewriter: ✅ Found .uix file: ${absoluteUixPath}`);
            } catch (err2) {
              // Neither exists, default to .ui (matches source code convention)
              newExtension = ".ui";
              console.log(`[SWITE] import-rewriter: ⚠️ Neither .ui nor .uix found, defaulting to .ui for ${baseSpecifier} (checked: ${absoluteUiPath}, ${absoluteUixPath})`);
            }
          }
        } else {
          // Default: TypeScript files use .ts
          newExtension = ".ts";
        }
        
        const baseSpecifier = actualSpecifier.slice(0, -3); // Remove .js
        const newSpecifier = baseSpecifier + newExtension;
        
        console.log(
          `[SWITE] import-rewriter: 🔧 Changing "${actualSpecifier}" -> "${newSpecifier}" (context: ${isSwissPackage ? 'swiss-pkg' : isUixFile ? 'uix' : 'ts'})`,
        );
        
        // Replace in the code using the original start/end positions
        // If hasQuotes was true, start/end point to specifier WITHOUT quotes
        // If hasQuotes was false but quotes found, start/end were adjusted to include quotes
        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalSpecifier = quoteChar ? quoteChar + newSpecifier + quoteChar : `"${newSpecifier}"`;
        rewritten = before + finalSpecifier + after;
        offset += finalSpecifier.length - originalLength;
        
        console.log(
          `[SWITE] import-rewriter: ✅ Fixed relative import: "${actualSpecifier}" -> "${newSpecifier}"`,
        );
        continue; // Don't process further (relative imports don't need module resolution)
      }
      
      // Skip other relative imports - they don't need rewriting
      // BUT: Convert /swiss-lib/ paths to /swiss-packages/ paths
      // Check for /swiss-lib/ anywhere in the path, not just at the start
      if (actualSpecifier.includes("/swiss-lib/")) {
        // Replace /swiss-lib/packages/ with /swiss-packages/ (not /swiss-packages/packages/)
        const converted = actualSpecifier.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
        console.log(
          `[SWITE] import-rewriter: Converting /swiss-lib/ to /swiss-packages/: "${actualSpecifier}" -> "${converted}"`,
        );
        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalSpecifier = quoteChar ? quoteChar + converted + quoteChar : `"${converted}"`;
        rewritten = before + finalSpecifier + after;
        offset += finalSpecifier.length - originalLength;
        continue;
      }
      
      if (actualSpecifier.startsWith(".") || actualSpecifier.startsWith("/")) {
        continue;
      }

      // CRITICAL: es-module-lexer only returns static import specifiers
      // If we got here, it's ALWAYS a module specifier, never a variable
      // Just validate basic format (starts with letter or @)
      if (!/^[@a-zA-Z]/.test(actualSpecifier)) {
        console.warn(
          `[SWITE] import-rewriter: Invalid specifier format: ${actualSpecifier}`,
        );
        continue;
      }

      // Resolve the import
      console.log(
        `[SWITE] import-rewriter: Resolving ${actualSpecifier} from ${importer}`,
      );
      let resolved: string;
      try {
        resolved = await resolver.resolve(actualSpecifier, importer);
        console.log(
          `[SWITE] import-rewriter: Resolved ${actualSpecifier} -> ${resolved}`,
        );

        // CRITICAL: If resolver returns unchanged or invalid, use CDN fallback
        if (
          !resolved ||
          resolved === actualSpecifier ||
          (!resolved.startsWith("/") && !resolved.startsWith("http"))
        ) {
          console.warn(
            `[SWITE] import-rewriter: Resolver returned invalid/unchanged result for ${actualSpecifier}, using CDN fallback`,
          );
          resolved = `https://cdn.jsdelivr.net/npm/${actualSpecifier}/+esm`;
        }
      } catch (error) {
        console.error(
          `[SWITE] import-rewriter: Error resolving ${actualSpecifier}:`,
          error,
        );
        resolved = `https://cdn.jsdelivr.net/npm/${actualSpecifier}/+esm`;
      }

      // For development: prefer src/ over dist/ for SWISS and workspace packages
      if (resolved.includes("/dist/")) {
        const isSwissOrPackages =
          resolved.includes("/swiss-packages/") || resolved.includes("/packages/");
        if (isSwissOrPackages) {
          resolved = resolved.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
        }
      }

      // Replace the specifier
      console.log(
        `[SWITE] import-rewriter: Replacing "${actualSpecifier}" with "${resolved}" (quoteChar: ${quoteChar})`,
      );
      if (quoteChar) {
        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalResolved = quoteChar + resolved + quoteChar;
        rewritten = before + finalResolved + after;
        offset += finalResolved.length - originalLength;
        console.log(
          `[SWITE] import-rewriter: ✅ Replaced "${actualSpecifier}" with "${finalResolved}"`,
        );
      } else {
        // No quote char (shouldn't happen, but handle it)
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalResolved = `"${resolved}"`;
        rewritten = before + finalResolved + after;
        offset += finalResolved.length - (end - start);
        console.log(
          `[SWITE] import-rewriter: ✅ Replaced (no quote) "${actualSpecifier}" with "${finalResolved}"`,
        );
      }

      // CRITICAL: Verify the replacement worked
      if (
        rewritten.includes(actualSpecifier) &&
        !rewritten.includes(resolved)
      ) {
        console.error(
          `[SWITE] import-rewriter: ⚠️ WARNING - Replacement failed! Import "${actualSpecifier}" still in code but "${resolved}" not found`,
        );
        // FORCE replacement as last resort
        console.error(
          `[SWITE] import-rewriter: 🔧 FORCING replacement of "${actualSpecifier}" with "${resolved}"`,
        );
        rewritten = rewritten.replace(
          new RegExp(
            actualSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "g",
          ),
          resolved,
        );
      }
    }

    // FINAL CHECK: Ensure no bare imports remain
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/;
    if (bareImportPattern.test(rewritten)) {
      const matches = Array.from(rewritten.matchAll(bareImportPattern));
      for (const match of matches) {
        const bareImport = match[1];
        if (
          !bareImport.startsWith("/") &&
          !bareImport.startsWith("http") &&
          !bareImport.startsWith(".")
        ) {
          console.error(
            `[SWITE] import-rewriter: ⚠️ CRITICAL - Bare import "${bareImport}" still in code after rewriting!`,
          );
          // Force CDN fallback (jsDelivr; esm.sh returns 500 for some packages)
          const cdnUrl = `https://cdn.jsdelivr.net/npm/${bareImport}/+esm`;
          rewritten = rewritten.replace(
            new RegExp(bareImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            cdnUrl,
          );
          console.error(
            `[SWITE] import-rewriter: 🔧 FORCED replacement of "${bareImport}" with "${cdnUrl}"`,
          );
        }
      }
    }

    // CRITICAL: Apply additional regex-based fix for relative .js imports
    // This catches any cases the lexer-based approach might miss
    // BUT: We need to be context-aware:
    // - If importer is in /swiss-packages/, change .js to .ts (SWISS packages use .ts)
    // - If importer is a .uix/.ui file, change .js to .uix (app files)
    // - Otherwise, change .js to .ts (default for TypeScript files)
    const relativeJsImportRegex = /from\s+(["'])(\.\.?\/[^"']*?)(\.js)(\1)/g;
    const beforeRegexFix = rewritten;
    let regexFixCount = 0;
    // Normalize path separators for Windows compatibility
    const normalizedImporter = importer.replace(/\\/g, "/");
    const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
    const isUixFile = normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");
    
    rewritten = rewritten.replace(relativeJsImportRegex, (match, quote, path, jsExt, endQuote) => {
      // Skip if it's in node_modules or absolute paths
      if (path.includes("node_modules") || !path.startsWith(".")) {
        return match;
      }
      
      // Determine correct extension based on context
      // IMPORTANT: Check /lib/ and /swiss-packages/ FIRST before checking file extension
      // Normalize path separators for Windows compatibility (importer is a file system path)
      const normalizedImporter = importer.replace(/\\/g, "/");
      const isLibPath = normalizedImporter.includes("/lib/");
      let newExtension: string;
      if (isSwissPackage) {
        // SWISS packages use .ts files
        newExtension = ".ts";
      } else if (isLibPath) {
        // /lib/ paths can have .ts, .ui, or .uix files
        // Default to .ts for /lib/ paths (most common - types, core logic, etc.)
        // Handlers will try .ui/.uix if .ts doesn't exist
        newExtension = ".ts";
        console.log(
          `[SWITE] import-rewriter: 🎯 Regex /lib/ path detected - using .ts extension (importer: ${importer})`,
        );
      } else if (isUixFile) {
        // If importing from a .uix/.ui file, check what the actual file extension is
        // The source code uses .ui, so we should preserve that
        // Only use .uix if the source file is actually .uix
        if (normalizedImporter.endsWith(".ui")) {
          // Source is .ui, so imports should also be .ui (not .uix)
          newExtension = ".ui";
        } else {
          // Source is .uix, imports can be .uix
          newExtension = ".uix";
        }
      } else {
        // Default: TypeScript files use .ts
        newExtension = ".ts";
      }
      
      const newPath = path + newExtension;
      console.log(
        `[SWITE] import-rewriter: 🔧 Regex fix (context: ${isSwissPackage ? 'swiss-pkg' : isUixFile ? 'uix' : 'ts'}): ${match} -> from ${quote}${newPath}${endQuote}`,
      );
      regexFixCount++;
      return `from ${quote}${newPath}${endQuote}`;
    });
    
    if (regexFixCount > 0) {
      console.log(
        `[SWITE] import-rewriter: ✅ Regex fix applied ${regexFixCount} change(s)`,
      );
    } else {
      // Debug: Check if there are any relative .js imports that weren't caught
      const testRegex = /from\s+["'](\.\.?\/[^"']+\.js)["']/g;
      const testMatches = Array.from(rewritten.matchAll(testRegex));
      if (testMatches.length > 0) {
        console.log(
          `[SWITE] import-rewriter: ⚠️  Found ${testMatches.length} relative .js import(s) that weren't fixed:`,
        );
        testMatches.slice(0, 3).forEach(m => console.log(`  - ${m[0]}`));
      }
    }

    // Final pass: Convert any remaining /swiss-lib/ paths to /swiss-packages/
    // This catches paths that might have been generated by the compiler or resolver
    // Use multiple passes to catch all variations
    if (rewritten.includes("/swiss-lib/")) {
      const beforeFinal = rewritten;
      // Pass 1: Replace /swiss-lib/packages/ with /swiss-packages/
      rewritten = rewritten.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
      // Pass 2: Replace any remaining /swiss-lib/ with /swiss-packages/
      rewritten = rewritten.replace(/\/swiss-lib\//g, "/swiss-packages/");
      // Pass 3: Fix in quoted strings (both single and double quotes)
      rewritten = rewritten.replace(/(['"])\/swiss-lib\//g, '$1/swiss-packages/');
      if (beforeFinal !== rewritten) {
        console.log(
          chalk.yellow(`[SWITE] import-rewriter: Final pass converted /swiss-lib/ to /swiss-packages/ (${beforeFinal.split('/swiss-lib/').length - 1} occurrences)`),
        );
      }
    }

    console.log(
      `[SWITE] import-rewriter: Finished rewriting ${imports.length} import(s) in ${importer}`,
    );
    return rewritten;
  } catch (error) {
    console.error(
      `[SWITE] import-rewriter: Error rewriting imports in ${importer}:`,
      error,
    );
    if (error instanceof Error) {
      console.error(`[SWITE] import-rewriter: Error stack:`, error.stack);
    }
    return code; // Return original on error
  }
}
