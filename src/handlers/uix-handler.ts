/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { UiCompiler } from "@swissjs/compiler";
import chalk from "chalk";
import { rewriteImports } from "../import-rewriter.js";
import { compilationCache } from "../cache/compilation-cache.js";
import {
  BaseHandler,
  setDevHeaders,
  type HandlerContext,
} from "./base-handler.js";

export class UIXHandler extends BaseHandler {
  private compiler = new UiCompiler();

  constructor(context: HandlerContext) {
    super(context);
  }

  /**
   * Extract dependencies from compiled code (import paths)
   */
  private async getDependencies(compiled: string): Promise<string[]> {
    const deps: string[] = [];
    const importPattern = /(?:import|from|export).*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(compiled)) !== null) {
      const specifier = match[1];
      // Only track absolute paths and workspace paths (not relative)
      if (specifier.startsWith("/") || specifier.startsWith("@")) {
        try {
          const resolved = await this.context.resolver.resolve(
            specifier,
            "",
          );
          if (resolved && !resolved.startsWith("http")) {
            deps.push(resolved);
          }
        } catch {
          // Ignore resolution errors
        }
      }
    }
    return deps;
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    console.log(chalk.blue(`[.uix] ${url}`));

    // Check cache first
    let cached = await compilationCache.get(
      filePath,
      (compiled) => this.getDependencies(compiled),
    );
    if (cached) {
      // CRITICAL: Strip /swiss-lib/ paths from cached code too
      // Old cache entries may have /swiss-lib/ paths from before the fix
      if (cached.includes("/swiss-lib/")) {
        console.log(chalk.yellow(`[.uix] Fixing /swiss-lib/ paths in cached code for ${url}`));
        cached = cached.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
        cached = cached.replace(/\/swiss-lib\//g, "/swiss-packages/");
        // Also fix in import statements and URLs (preserve quote type)
        cached = cached.replace(/(['"])\/swiss-lib\//g, '$1/swiss-packages/');
      }
      setDevHeaders(res);
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.send(cached);
      return;
    }

    // Cache miss - compile
    const source = await fs.readFile(filePath, "utf-8");
    let compiled = await this.compiler.compileAsync(source, filePath);

    // CRITICAL: Strip /swiss-lib/ paths from compiled output BEFORE import rewriting
    // The compiler may output /swiss-lib/ paths directly in the code
    if (compiled.includes("/swiss-lib/")) {
      const beforeSwissLibFix = compiled;
      // Fix all variations of /swiss-lib/ paths
      compiled = compiled.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
      compiled = compiled.replace(/\/swiss-lib\//g, "/swiss-packages/");
      // Also fix in import statements and URLs (preserve quote type)
      compiled = compiled.replace(/(['"])\/swiss-lib\//g, '$1/swiss-packages/');
      if (beforeSwissLibFix !== compiled) {
        console.log(chalk.yellow(`[.uix] Fixed /swiss-lib/ paths in compiled output for ${url}`));
      }
    }

    // Strip CSS imports - they should be handled as static assets, not modules
    // Use aggressive regex that matches all CSS import patterns
    const beforeCssStrip = compiled;
    
    // Pattern 1: Match standalone import statements for CSS (with or without semicolon, on their own line)
    compiled = compiled.replace(/^\s*import\s+.*?\.css\s*['"];?\s*$/gm, '');
    
    // Pattern 2: Match CSS imports anywhere in the code (more aggressive) - including without quotes
    compiled = compiled.replace(/\bimport\s+.*?\.css\s*['"];?/g, '');
    compiled = compiled.replace(/\bimport\s+['"].*?\.css['"];?/g, '');
    
    // Pattern 3: Match dynamic imports for CSS
    compiled = compiled.replace(/import\s*\(\s*['"].*?\.css['"]\s*\)/g, '');
    
    // Pattern 4: Match CSS imports with different quote styles and whitespace
    compiled = compiled.replace(/import\s+['"](.*?\.css)['"];?/g, '');
    
    if (beforeCssStrip !== compiled) {
      console.log(chalk.blue(`[.uix] Stripped CSS imports from ${url}`));
    }

    // Debug: Check for bare imports (only match actual bare imports, not paths)
    // Pattern matches: import ... from "@package/name" or import("@package/name")
    // But NOT: import ... from "/path/to/@package/name" (already a path)
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/;
    if (bareImportPattern.test(compiled)) {
      console.log(
        chalk.yellow(
          `[.uix] WARNING: Compiled code contains bare imports: ${url}`,
        ),
      );
    }

    const rewritten = await rewriteImports(
      compiled,
      filePath,
      this.context.resolver,
    );

    // FINAL SAFETY: Strip any remaining /swiss-lib/ paths after import rewriting
    // This catches any paths that might have slipped through
    let finalCode = rewritten;
    if (finalCode.includes("/swiss-lib/")) {
      const beforeFinal = finalCode;
      finalCode = finalCode.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
      finalCode = finalCode.replace(/\/swiss-lib\//g, "/swiss-packages/");
      finalCode = finalCode.replace(/(['"])\/swiss-lib\//g, '$1/swiss-packages/');
      if (beforeFinal !== finalCode) {
        console.log(chalk.red(`[.uix] ⚠️ FINAL PASS: Fixed ${beforeFinal.split('/swiss-lib/').length - 1} remaining /swiss-lib/ paths in ${url}`));
      }
    }

    // Store in cache
    await compilationCache.set(
      filePath,
      compiled,
      finalCode,
      (compiled) => this.getDependencies(compiled),
    );

    // Debug: Verify no bare imports remain after rewriting
    if (bareImportPattern.test(finalCode)) {
      console.log(
        chalk.red(
          `[.uix] ERROR: Bare imports still present after rewriting: ${url}`,
        ),
      );
      const matches = Array.from(
        rewritten.matchAll(
          /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/g,
        ),
      );
      for (const match of matches.slice(0, 3)) {
        console.log(chalk.red(`[.uix] Unresolved import: ${match[1]}`));
      }
    }

    setDevHeaders(res);
    res.send(finalCode);
  }
}
