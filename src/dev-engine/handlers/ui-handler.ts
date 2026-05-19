/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { UiCompiler } from "@swissjs/compiler";
import chalk from "chalk";
import { rewriteImports } from "../../resolution/rewriting/import-rewriter.js";
import { inlineEnvReferences } from "../../config/env.js";
import { compilationCache } from "../../internal/cache/compilation-cache.js";
import { fixSwissLibPaths } from "../../resolution/path/path-fixup.js";
import {
  BaseHandler,
  setDevHeaders,
  type HandlerContext,
} from "./base-handler.js";

export class UIHandler extends BaseHandler {
  private compiler = new UiCompiler();

  constructor(context: HandlerContext) {
    super(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    console.log(chalk.blue(`[.ui] ${url} → ${filePath}`));

    try {
      await fs.access(filePath);
    } catch {
      console.error(chalk.red(`[.ui] File not found: ${filePath}`));
      throw new Error(`File not found: ${url} (resolved to: ${filePath})`);
    }

    // Cache hit
    const cached = await compilationCache.get(filePath, (compiled) => this.getDependencies(compiled));
    if (cached) {
      const fixed = fixSwissLibPaths(cached);
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

    // Fix compiler-emitted wrong paths before import rewriting
    compiled = fixSwissLibPaths(compiled);

    // Inline import.meta.env references before import rewriting
    compiled = inlineEnvReferences(compiled, this.context.env);

    // Strip CSS static-asset imports — they are not ES modules
    compiled = stripCssImports(compiled, url);

    const bareImportPattern = /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/;
    if (bareImportPattern.test(compiled)) {
      console.warn(`[.ui] Compiled output contains bare imports: ${url}`);
    }

    const rewritten = await rewriteImports(compiled, filePath, this.context.resolver);
    const finalCode = fixSwissLibPaths(rewritten);

    await compilationCache.set(filePath, compiled, finalCode, (c) => this.getDependencies(c));

    if (bareImportPattern.test(finalCode)) {
      console.error(`[.ui] Bare imports still present after rewriting: ${url}`);
      for (const m of Array.from(rewritten.matchAll(/(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/g)).slice(0, 3)) {
        console.error(`[.ui] Unresolved import: ${m[1]}`);
      }
    }

    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(finalCode, "utf-8"));
    res.end(finalCode, "utf-8");
  }
}

function stripCssImports(code: string, url: string): string {
  // Single well-ordered pass: static imports first, then dynamic imports
  const before = code;
  code = code.replace(/^[^\S\r\n]*import\s[^'"]*['"][^'"]*\.css['"]\s*;?[^\S\r\n]*$/gm, "");
  code = code.replace(/\bimport\s*\(\s*['"][^'"]*\.css['"]\s*\)/g, "undefined");
  if (before !== code) {
    console.log(chalk.blue(`[.ui] Stripped CSS imports from ${url}`));
  }
  return code;
}
