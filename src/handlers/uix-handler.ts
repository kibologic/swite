/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { UiCompiler } from "@kibologic/compiler";
import chalk from "chalk";
import { rewriteImports } from "../import-rewriter.js";
import { inlineEnvReferences } from "../env.js";
import { compilationCache } from "../cache/compilation-cache.js";
import { fixSwissLibPaths } from "../utils/path-fixup.js";
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

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    console.log(chalk.blue(`[.uix] ${url}`));

    // Cache hit
    const cached = await compilationCache.get(filePath, (compiled) => this.getDependencies(compiled));
    if (cached) {
      const fixed = fixSwissLibPaths(cached);
      setDevHeaders(res);
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.send(fixed);
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
    const beforeCss = compiled;
    compiled = compiled.replace(/^[^\S\r\n]*import\s[^'"]*['"][^'"]*\.css['"]\s*;?[^\S\r\n]*$/gm, "");
    compiled = compiled.replace(/\bimport\s*\(\s*['"][^'"]*\.css['"]\s*\)/g, "undefined");
    if (beforeCss !== compiled) {
      console.log(chalk.blue(`[.uix] Stripped CSS imports from ${url}`));
    }

    const bareImportPattern = /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/;
    if (bareImportPattern.test(compiled)) {
      console.warn(`[.uix] Compiled output contains bare imports: ${url}`);
    }

    const rewritten = await rewriteImports(compiled, filePath, this.context.resolver);
    const finalCode = fixSwissLibPaths(rewritten);

    await compilationCache.set(filePath, compiled, finalCode, (c) => this.getDependencies(c));

    if (bareImportPattern.test(finalCode)) {
      console.error(`[.uix] Bare imports still present after rewriting: ${url}`);
      for (const m of Array.from(rewritten.matchAll(/(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/g)).slice(0, 3)) {
        console.error(`[.uix] Unresolved import: ${m[1]}`);
      }
    }

    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(finalCode);
  }
}
