/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { rewriteImports } from "../import-rewriter.js";
import {
  BaseHandler,
  setDevHeaders,
  type HandlerContext,
} from "./base-handler.js";
import { UIHandler } from "./ui-handler.js";
import { UIXHandler } from "./uix-handler.js";
import { TSHandler } from "./ts-handler.js";

export class JSHandler extends BaseHandler {
  private uiHandler: UIHandler;
  private uixHandler: UIXHandler;
  private tsHandler: TSHandler;

  constructor(context: HandlerContext) {
    super(context);
    this.uiHandler = new UIHandler(context);
    this.uixHandler = new UIXHandler(context);
    this.tsHandler = new TSHandler(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);

    // Check if .js file exists, if not try .ts, .ui, .uix
    try {
      await fs.access(filePath);
    } catch {
      // .js doesn't exist, try alternatives
      const basePath = filePath.slice(0, -3); // Remove .js
      const alternatives = [
        {
          ext: ".ts",
          handler: () =>
            this.tsHandler.handle(url.replace(/\.js$/, ".ts"), res),
        },
        {
          ext: ".ui",
          handler: () =>
            this.uiHandler.handle(url.replace(/\.js$/, ".ui"), res),
        },
        {
          ext: ".uix",
          handler: () =>
            this.uixHandler.handle(url.replace(/\.js$/, ".uix"), res),
        },
      ];

      for (const alt of alternatives) {
        try {
          const altPath = basePath + alt.ext;
          await fs.access(altPath);
          console.log(
            chalk.yellow(
              `[.js→${alt.ext}] ${url} → ${url.replace(/\.js$/, alt.ext)} (file: ${altPath})`,
            ),
          );
          return await alt.handler();
        } catch {
          // Try next alternative
          console.log(
            chalk.gray(
              `[.js→${alt.ext}] ${basePath + alt.ext} not found, trying next...`,
            ),
          );
        }
      }

      // No alternatives found, throw error
      console.error(
        chalk.red(`[.js] File not found: ${url} (tried .js, .ts, .ui, .uix)`),
      );
      console.error(chalk.red(`[.js] filePath was: ${filePath}`));
      console.error(chalk.red(`[.js] basePath was: ${basePath}`));
      throw new Error(`File not found: ${url} (tried .js, .ts, .ui, .uix)`);
    }

    // .js file exists, process it normally
    const source = await fs.readFile(filePath, "utf-8");

    // Debug: Check for bare imports (including simple npm packages like bcryptjs)
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/;
    const simpleNpmPattern =
      /(?:import|from|export).*['"]([a-zA-Z][a-zA-Z0-9_-]*)[^'"]*['"]/;
    if (bareImportPattern.test(source) || simpleNpmPattern.test(source)) {
      console.log(chalk.yellow(`[.js] Found imports in ${url}, rewriting...`));
      // Log the actual imports found
      const importMatches = source.matchAll(
        /(?:import|from)\s+['"]([^'"]+)['"]/g,
      );
      for (const match of importMatches) {
        console.log(chalk.cyan(`[.js] Found import: ${match[1]}`));
      }
    }

    const rewritten = await rewriteImports(
      source,
      filePath,
      this.context.resolver,
    );

    // Debug: Verify no bare imports remain after rewriting
    if (bareImportPattern.test(rewritten)) {
      console.error(
        chalk.red(
          `[.js] WARNING: Bare imports still present in ${url} after rewriting!`,
        ),
      );
      const matches = Array.from(
        rewritten.matchAll(
          /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/g,
        ),
      );
      for (const match of matches.slice(0, 3)) {
        console.error(chalk.red(`[.js] Unresolved: ${match[1]}`));
      }
    }

    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(rewritten);
  }
}
