/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { UiCompiler } from "@swissjs/compiler";
import chalk from "chalk";
import { ModuleResolver } from "../../resolution/resolver.js";
import { resolveFilePath } from "../../resolution/path/file-path-resolver.js";
import { rewriteImports } from "../../resolution/rewriting/import-rewriter.js";
import { inlineEnvReferences } from "../../config/env.js";
import { compilationCache } from "../../internal/cache/compilation-cache.js";
import { fixSwissLibPaths } from "../../resolution/path/path-fixup.js";
import type { SwiteUserConfig } from "../../config/config.js";

export interface HandlerContext {
  resolver: ModuleResolver;
  root: string;
  workspaceRoot: string | null;
  env?: Record<string, string>;
  userConfig?: SwiteUserConfig;
}

/**
 * Set cache-busting headers for development
 */
export function setDevHeaders(res: Response): void {
  // Prevent all caching during development
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

const BARE_IMPORT_RE = /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/;

/**
 * Base handler utilities
 */
export class BaseHandler {
  private compiler = new UiCompiler();

  constructor(protected context: HandlerContext) {}

  /**
   * Shared compile-and-serve pipeline used by UIHandler and UIXHandler.
   * Compiles a .ui/.uix file, rewrites imports, applies path fixup, and sends the response.
   */
  protected async compileAndServe(
    url: string,
    filePath: string,
    res: Response,
    label: string,
  ): Promise<void> {
    const pathFixupEnabled = this.context.userConfig?.compilerPathFixup?.enabled !== false;
    const pathFixupPatterns = this.context.userConfig?.compilerPathFixup?.patterns;
    const applyPathFixup = (code: string) =>
      pathFixupEnabled ? fixSwissLibPaths(code, pathFixupPatterns) : code;

    // Cache hit
    const cached = await compilationCache.get(filePath, (c) => this.getDependencies(c));
    if (cached) {
      const fixed = applyPathFixup(cached);
      setDevHeaders(res);
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(fixed, "utf-8"));
      res.end(fixed, "utf-8");
      return;
    }

    // Cache miss — compile
    const source = await fs.readFile(filePath, "utf-8");
    let compiled = await this.compiler.compileAsync(source, filePath);

    const esbuild = await import("esbuild");
    const tsResult = await esbuild.transform(compiled, {
      loader: "ts",
      format: "esm",
      target: "esnext",
      sourcefile: filePath,
    });
    compiled = tsResult.code;

    compiled = applyPathFixup(compiled);
    compiled = inlineEnvReferences(compiled, this.context.env);

    // Strip CSS static-asset imports — they are not ES modules
    const beforeCss = compiled;
    compiled = compiled.replace(/^[^\S\r\n]*import\s[^'"]*['"][^'"]*\.css['"]\s*;?[^\S\r\n]*$/gm, "");
    compiled = compiled.replace(/\bimport\s*\(\s*['"][^'"]*\.css['"]\s*\)/g, "undefined");
    if (beforeCss !== compiled) {
      console.log(chalk.blue(`[${label}] Stripped CSS imports from ${url}`));
    }

    if (BARE_IMPORT_RE.test(compiled)) {
      console.warn(`[${label}] Compiled output contains bare imports: ${url}`);
    }

    const rewritten = await rewriteImports(compiled, filePath, this.context.resolver);
    const finalCode = applyPathFixup(rewritten);

    await compilationCache.set(filePath, compiled, finalCode, (c) => this.getDependencies(c));

    if (BARE_IMPORT_RE.test(finalCode)) {
      console.error(`[${label}] Bare imports still present after rewriting: ${url}`);
      for (const m of Array.from(rewritten.matchAll(/(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/g)).slice(0, 3)) {
        console.error(`[${label}] Unresolved import: ${m[1]}`);
      }
    }

    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(finalCode, "utf-8"));
    res.end(finalCode, "utf-8");
  }

  protected async resolveFilePath(url: string): Promise<string> {
    return resolveFilePath(url, this.context.root, this.context.workspaceRoot, this.context.userConfig);
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  protected async getDependencies(compiled: string): Promise<string[]> {
    const deps: string[] = [];
    const importPattern = /(?:import|from|export).*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(compiled)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith("/") || specifier.startsWith("@")) {
        try {
          const resolved = await this.context.resolver.resolve(specifier, "");
          if (resolved && !resolved.startsWith("http")) {
            deps.push(resolved);
          }
        } catch {
          // ignore resolution errors during dependency tracking
        }
      }
    }
    return deps;
  }
}
