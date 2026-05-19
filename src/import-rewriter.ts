/*
 * Import Rewriter for SWITE
 *
 * Design: collect-then-apply-right-to-left
 *
 * es-module-lexer gives positions {s, e} in the ORIGINAL string. The previous
 * implementation tracked a running `offset` as replacements were applied, which
 * accumulated errors when quote handling changed string lengths in unexpected
 * ways and required three layers of fallback replacement logic.
 *
 * Instead we now:
 *  1. Collect every replacement as {start, end, text} in original-string coordinates
 *  2. Sort descending by start position
 *  3. Apply right-to-left — each substitution cannot shift the position of any
 *     replacement to its left, so no offset tracking is needed at all.
 */

import { init, parse } from "es-module-lexer";
import { ModuleResolver } from "./resolver.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { shouldUseCdnFallback } from "./utils/cdn-fallback.js";

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export async function rewriteImports(
  code: string,
  importer: string,
  resolver: ModuleResolver,
): Promise<string> {
  await init;

  try {
    const [imports] = parse(code);
    if (imports.length === 0) return code;

    const replacements: Replacement[] = [];

    for (const imp of imports) {
      const { s: rawStart, e: rawEnd } = imp;
      const rawSpecifier = code.slice(rawStart, rawEnd);

      // Skip CSS imports — handled as static assets
      if (rawSpecifier.includes(".css")) continue;

      // Determine actual specifier string and the span in `code` that includes quotes
      const { specifier, start, end } = resolveQuotedSpan(code, rawSpecifier, rawStart, rawEnd);
      if (specifier === null) continue;

      // Fix compiler bug: .uix/.ui imports emitted as .js or .tsx
      if (
        specifier.startsWith(".") &&
        (specifier.endsWith(".js") || specifier.endsWith(".tsx")) &&
        !specifier.includes("node_modules")
      ) {
        const newExt = await resolveExtensionFix(specifier, importer);
        if (newExt) {
          const base = specifier.endsWith(".tsx") ? specifier.slice(0, -4) : specifier.slice(0, -3);
          replacements.push({ start, end, text: `"${base}${newExt}"` });
          continue;
        }
      }

      // Skip relative and absolute path imports (already resolved)
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;

      if (!/^[@a-zA-Z]/.test(specifier)) {
        console.warn(`[SWITE] import-rewriter: Invalid specifier format: ${specifier}`);
        continue;
      }

      // Resolve bare import
      let resolved: string;
      try {
        resolved = await resolver.resolve(specifier, importer);
        if (!resolved || resolved === specifier || (!resolved.startsWith("/") && !resolved.startsWith("http"))) {
          console.warn(chalk.yellow(`[SWITE] import-rewriter: Resolver returned invalid result for ${specifier}, using CDN fallback`));
          resolved = shouldUseCdnFallback(specifier)
            ? `https://cdn.jsdelivr.net/npm/${specifier}/+esm`
            : `/node_modules/${specifier}`;
        }
      } catch (error) {
        console.error(chalk.red(`[SWITE] import-rewriter: Error resolving ${specifier}:`), error);
        resolved = shouldUseCdnFallback(specifier)
          ? `https://cdn.jsdelivr.net/npm/${specifier}/+esm`
          : `/node_modules/${specifier}`;
      }

      // Prefer src/ over dist/ for workspace/swiss packages in dev
      if (resolved.includes("/dist/") && (resolved.includes("/swiss-packages/") || resolved.includes("/packages/"))) {
        resolved = resolved.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
      }

      replacements.push({ start, end, text: `"${resolved}"` });
    }

    // Apply right-to-left so earlier positions are never shifted by later replacements
    replacements.sort((a, b) => b.start - a.start);
    let result = code;
    for (const { start, end, text } of replacements) {
      result = result.slice(0, start) + text + result.slice(end);
    }

    // Safety net: catch any bare scoped imports the lexer may have missed
    const barePattern = /(?:import|from|export)\s+['"](@[^'"]+\/[^'"]+)[^'"]*['"]/g;
    for (const match of Array.from(result.matchAll(barePattern))) {
      const bareImport = match[1];
      if (!bareImport.startsWith("/") && !bareImport.startsWith("http") && !bareImport.startsWith(".")) {
        console.error(chalk.red(`[SWITE] import-rewriter: CRITICAL — bare import "${bareImport}" still present after rewriting`));
        const replacement = shouldUseCdnFallback(bareImport)
          ? `https://cdn.jsdelivr.net/npm/${bareImport}/+esm`
          : `/node_modules/${bareImport}`;
        result = result.replace(
          new RegExp(bareImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          replacement,
        );
      }
    }

    // Regex fallback: fix relative .js/.tsx extension mismatches the lexer may have missed
    const normalizedImporter = importer.replace(/\\/g, "/");
    const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
    const isUixFile = normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");

    result = result.replace(
      /from\s+(["'])(\.\.?\/[^"']*?)(\.js|\.tsx)(\1)/g,
      (match, quote, importPath, _ext, endQuote) => {
        if (importPath.includes("node_modules") || !importPath.startsWith(".")) return match;
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

    return result;
  } catch (error) {
    console.error(chalk.red(`[SWITE] import-rewriter: Error rewriting imports in ${importer}:`), error);
    return code;
  }
}

/**
 * Given a raw specifier token from es-module-lexer, find the full quoted span
 * in `code` (including the surrounding quote characters) and extract the clean
 * specifier string. Returns `{specifier: null}` when the span cannot be found.
 */
function resolveQuotedSpan(
  code: string,
  rawSpecifier: string,
  rawStart: number,
  rawEnd: number,
): { specifier: string | null; start: number; end: number } {
  const first = rawSpecifier[0];
  const last = rawSpecifier[rawSpecifier.length - 1];

  // Case 1: lexer returned the specifier WITH surrounding quotes
  if ((first === '"' || first === "'") && first === last) {
    return {
      specifier: rawSpecifier.slice(1, -1),
      start: rawStart,
      end: rawEnd,
    };
  }

  // Case 2: lexer returned the bare specifier; look one char back/forward for quotes
  const charBefore = rawStart > 0 ? code[rawStart - 1] : "";
  const charAfter = rawEnd < code.length ? code[rawEnd] : "";
  if ((charBefore === '"' || charBefore === "'") && charBefore === charAfter) {
    return {
      specifier: rawSpecifier,
      start: rawStart - 1,
      end: rawEnd + 1,
    };
  }

  // Case 3: search nearby for a quoted pattern
  const escaped = rawSpecifier.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const pattern = new RegExp(`(['"])${escaped}\\1`);
  const match = pattern.exec(code);
  if (match) {
    return {
      specifier: rawSpecifier,
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  console.warn(`[SWITE] import-rewriter: Could not find quotes for specifier: ${rawSpecifier}`);
  return { specifier: null, start: rawStart, end: rawEnd };
}

/**
 * Determine what extension a .js/.tsx import should be rewritten to,
 * based on the importer's context and the actual files present on disk.
 * Returns null when no rewrite is needed.
 */
async function resolveExtensionFix(specifier: string, importer: string): Promise<string | null> {
  const normalizedImporter = importer.replace(/\\/g, "/");
  const isSwissPackage = normalizedImporter.includes("/swiss-packages/");
  const isLibPath = normalizedImporter.includes("/lib/");
  const isUixFile = normalizedImporter.endsWith(".uix") || normalizedImporter.endsWith(".ui");

  if (isSwissPackage || isLibPath) return ".ts";

  if (isUixFile) {
    const base = specifier.endsWith(".tsx") ? specifier.slice(0, -4) : specifier.slice(0, -3);
    const currentDir = path.dirname(importer);
    const cleanPath = base.startsWith("./") ? base.slice(2) : base;
    const uiPath = path.resolve(currentDir, cleanPath + ".ui");
    const uixPath = path.resolve(currentDir, cleanPath + ".uix");
    try {
      await fs.access(uiPath);
      return ".ui";
    } catch {
      try {
        await fs.access(uixPath);
        return ".uix";
      } catch {
        return ".ui";
      }
    }
  }

  return ".ts";
}
