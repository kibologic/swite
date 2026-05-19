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
import { shouldUseCdnFallback } from "./utils/cdn-fallback.js";

export async function rewriteImports(
  code: string,
  importer: string,
  resolver: ModuleResolver,
): Promise<string> {
  await init;

  try {
    const [imports] = parse(code);

    if (imports.length === 0) return code;

    let rewritten = code;
    let offset = 0;

    for (const imp of imports) {
      let { s: start, e: end } = imp;
      const specifier = code.slice(start, end);

      // Skip CSS imports - handled as static assets, not modules
      if (specifier.includes(".css")) continue;

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
          const escapedSpecifier = specifier.replace(
            /[.*+?^${}()|[\]\\-]/g,
            "\\$&",
          );
          const quotedPattern = new RegExp(`(['"])${escapedSpecifier}\\1`);
          const match = quotedPattern.exec(code);
          if (match) {
            quoteChar = match[1];
            actualSpecifier = specifier;
            start = match.index!;
            end = match.index! + match[0].length;
          } else {
            console.warn(
              `[SWITE] import-rewriter: Could not find quotes for specifier: ${specifier}`,
            );
            continue;
          }
        }
      }

      // Fix compiler bug where .uix/.ui imports are changed to .js or .tsx
      if (
        actualSpecifier.startsWith(".") &&
        (actualSpecifier.endsWith(".js") || actualSpecifier.endsWith(".tsx")) &&
        !actualSpecifier.includes("node_modules")
      ) {
        const normalizedImporter = importer.replace(/\\/g, "/");
        const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
        const isLibPath = normalizedImporter.includes("/lib/");
        const isUixFile =
          normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");

        let newExtension: string;
        if (isSwissPackage) {
          newExtension = ".ts";
        } else if (isLibPath) {
          newExtension = ".ts";
        } else if (isUixFile) {
          const baseSpecifier = actualSpecifier.endsWith(".tsx")
            ? actualSpecifier.slice(0, -4)
            : actualSpecifier.slice(0, -3);
          const currentDir = path.dirname(importer);
          const cleanImportPath = baseSpecifier.startsWith("./")
            ? baseSpecifier.slice(2)
            : baseSpecifier;
          const absoluteUiPath = path.resolve(currentDir, cleanImportPath + ".ui");
          const absoluteUixPath = path.resolve(currentDir, cleanImportPath + ".uix");

          try {
            await fs.access(absoluteUiPath);
            newExtension = ".ui";
          } catch {
            try {
              await fs.access(absoluteUixPath);
              newExtension = ".uix";
            } catch {
              newExtension = ".ui";
            }
          }
        } else {
          newExtension = ".ts";
        }

        const baseSpecifier = actualSpecifier.endsWith(".tsx")
          ? actualSpecifier.slice(0, -4)
          : actualSpecifier.slice(0, -3);
        const newSpecifier = baseSpecifier + newExtension;

        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalSpecifier = quoteChar
          ? quoteChar + newSpecifier + quoteChar
          : `"${newSpecifier}"`;
        rewritten = before + finalSpecifier + after;
        offset += finalSpecifier.length - originalLength;
        continue;
      }

      // Convert /swiss-lib/ paths to /swiss-packages/
      if (actualSpecifier.includes("/swiss-lib/")) {
        const converted = actualSpecifier.replace(
          /\/swiss-lib\/packages\//g,
          "/swiss-packages/",
        );
        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalSpecifier = quoteChar
          ? quoteChar + converted + quoteChar
          : `"${converted}"`;
        rewritten = before + finalSpecifier + after;
        offset += finalSpecifier.length - originalLength;
        continue;
      }

      // Skip relative and absolute path imports
      if (actualSpecifier.startsWith(".") || actualSpecifier.startsWith("/")) {
        continue;
      }

      if (!/^[@a-zA-Z]/.test(actualSpecifier)) {
        console.warn(
          `[SWITE] import-rewriter: Invalid specifier format: ${actualSpecifier}`,
        );
        continue;
      }

      // Resolve the bare import
      let resolved: string;
      try {
        resolved = await resolver.resolve(actualSpecifier, importer);

        if (
          !resolved ||
          resolved === actualSpecifier ||
          (!resolved.startsWith("/") && !resolved.startsWith("http"))
        ) {
          console.warn(
            chalk.yellow(
              `[SWITE] import-rewriter: Resolver returned invalid result for ${actualSpecifier}, using CDN fallback`,
            ),
          );
          resolved = shouldUseCdnFallback(actualSpecifier)
            ? `https://cdn.jsdelivr.net/npm/${actualSpecifier}/+esm`
            : `/node_modules/${actualSpecifier}`;
        }
      } catch (error) {
        console.error(
          chalk.red(`[SWITE] import-rewriter: Error resolving ${actualSpecifier}:`),
          error,
        );
        resolved = shouldUseCdnFallback(actualSpecifier)
          ? `https://cdn.jsdelivr.net/npm/${actualSpecifier}/+esm`
          : `/node_modules/${actualSpecifier}`;
      }

      // Prefer src/ over dist/ for SWISS and workspace packages in development
      if (resolved.includes("/dist/")) {
        const isSwissOrPackages =
          resolved.includes("/swiss-packages/") ||
          resolved.includes("/packages/");
        if (isSwissOrPackages) {
          resolved = resolved.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
        }
      }

      // Replace the specifier in the output
      if (quoteChar) {
        const originalLength = end - start;
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalResolved = quoteChar + resolved + quoteChar;
        rewritten = before + finalResolved + after;
        offset += finalResolved.length - originalLength;
      } else {
        const before = rewritten.slice(0, start + offset);
        const after = rewritten.slice(end + offset);
        const finalResolved = `"${resolved}"`;
        rewritten = before + finalResolved + after;
        offset += finalResolved.length - (end - start);
      }

      // Verify the replacement worked; force it as a last resort
      if (rewritten.includes(actualSpecifier) && !rewritten.includes(resolved)) {
        console.error(
          chalk.red(
            `[SWITE] import-rewriter: Replacement failed for "${actualSpecifier}", forcing...`,
          ),
        );
        rewritten = rewritten.replace(
          new RegExp(actualSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          resolved,
        );
      }
    }

    // Final check: force-replace any remaining bare imports
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/;
    if (bareImportPattern.test(rewritten)) {
      for (const match of Array.from(rewritten.matchAll(bareImportPattern))) {
        const bareImport = match[1];
        if (
          !bareImport.startsWith("/") &&
          !bareImport.startsWith("http") &&
          !bareImport.startsWith(".")
        ) {
          console.error(
            chalk.red(
              `[SWITE] import-rewriter: CRITICAL — bare import "${bareImport}" still present after rewriting`,
            ),
          );
          const replacement = shouldUseCdnFallback(bareImport)
            ? `https://cdn.jsdelivr.net/npm/${bareImport}/+esm`
            : `/node_modules/${bareImport}`;
          rewritten = rewritten.replace(
            new RegExp(bareImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            replacement,
          );
        }
      }
    }

    // Regex-based fallback: fix remaining relative .js/.tsx imports the lexer may have missed
    const normalizedImporter = importer.replace(/\\/g, "/");
    const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
    const isUixFile =
      normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");
    const relativeJsImportRegex = /from\s+(["'])(\.\.?\/[^"']*?)(\.js|\.tsx)(\1)/g;

    rewritten = rewritten.replace(
      relativeJsImportRegex,
      (match, quote, importPath, _jsExt, endQuote) => {
        if (importPath.includes("node_modules") || !importPath.startsWith(".")) {
          return match;
        }
        const isLibPath = normalizedImporter.includes("/lib/");
        let newExt: string;
        if (isSwissPackage || isLibPath) {
          newExt = ".ts";
        } else if (isUixFile) {
          newExt = normalizedImporter.endsWith(".ui") ? ".ui" : ".uix";
        } else {
          newExt = ".ts";
        }
        return `from ${quote}${importPath}${newExt}${endQuote}`;
      },
    );

    // Final pass: convert any remaining /swiss-lib/ paths
    if (rewritten.includes("/swiss-lib/")) {
      rewritten = rewritten.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
      rewritten = rewritten.replace(/\/swiss-lib\//g, "/swiss-packages/");
      rewritten = rewritten.replace(/(['"])\/swiss-lib\//g, "$1/swiss-packages/");
    }

    return rewritten;
  } catch (error) {
    console.error(
      chalk.red(`[SWITE] import-rewriter: Error rewriting imports in ${importer}:`),
      error,
    );
    return code; // Return original on error
  }
}
