/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { rewriteImports } from "../import-rewriter.js";
import { compilationCache } from "../cache/compilation-cache.js";
import {
  BaseHandler,
  setDevHeaders,
  type HandlerContext,
} from "./base-handler.js";

export class TSHandler extends BaseHandler {
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
    console.log(chalk.gray(`[.ts] ${url}`));

    // Check if .ts file exists, if not try .ui, .uix
    try {
      await fs.access(filePath);
    } catch {
      // .ts doesn't exist, try alternatives
      const basePath = filePath.slice(0, -3); // Remove .ts
      const alternatives = [
        {
          ext: ".ui",
          url: url.replace(/\.ts$/, ".ui"),
        },
        {
          ext: ".uix",
          url: url.replace(/\.ts$/, ".uix"),
        },
      ];

      for (const alt of alternatives) {
        try {
          const altPath = basePath + alt.ext;
          await fs.access(altPath);
          console.log(
            chalk.yellow(
              `[.ts→${alt.ext}] ${url} → ${alt.url} (file: ${altPath})`,
            ),
          );
          // Import and use the appropriate handler
          if (alt.ext === ".ui") {
            const { UIHandler } = await import("./ui-handler.js");
            const uiHandler = new UIHandler(this.context);
            return await uiHandler.handle(alt.url, res);
          } else if (alt.ext === ".uix") {
            const { UIXHandler } = await import("./uix-handler.js");
            const uixHandler = new UIXHandler(this.context);
            return await uixHandler.handle(alt.url, res);
          }
        } catch {
          // Try next alternative
          console.log(
            chalk.gray(
              `[.ts→${alt.ext}] ${basePath + alt.ext} not found, trying next...`,
            ),
          );
        }
      }

      // No alternatives found, throw error
      console.error(
        chalk.red(`[.ts] File not found: ${filePath} (and no alternatives found)`),
      );
      res.status(404).send(`File not found: ${url}`);
      return;
    }

    // Check cache first
    const cached = await compilationCache.get(
      filePath,
      (compiled) => this.getDependencies(compiled),
    );
    if (cached) {
      setDevHeaders(res);
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.send(cached);
      return;
    }

    // Cache miss - compile
    const source = await fs.readFile(filePath, "utf-8");

    // Use esbuild for fast TS transformation
    const esbuild = await import("esbuild");
    const result = await esbuild.transform(source, {
      loader: "ts",
      format: "esm",
      target: "esnext",
      sourcefile: filePath,
    });

    const rewritten = await rewriteImports(
      result.code,
      filePath,
      this.context.resolver,
    );

    // Store in cache (use result.code as "compiled" for dependency tracking)
    await compilationCache.set(
      filePath,
      result.code,
      rewritten,
      (compiled) => this.getDependencies(compiled),
    );

    // Debug: Check for bare imports after rewriting
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/;
    if (bareImportPattern.test(rewritten)) {
      console.log(
        chalk.red(
          `[.ts] ERROR: Bare imports still present after rewriting: ${url}`,
        ),
      );
      const matches = Array.from(
        rewritten.matchAll(
          /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/g,
        ),
      );
      for (const match of matches.slice(0, 3)) {
        console.log(chalk.red(`[.ts] Unresolved import: ${match[1]}`));
      }
    }

    setDevHeaders(res);
    res.send(rewritten);
  }
}
