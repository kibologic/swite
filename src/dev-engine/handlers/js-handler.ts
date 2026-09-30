/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { rewriteImports } from "../../resolution/rewriting/import-rewriter.js";
import { rewriteCssImports } from "./css-imports.js";
import {
  BaseHandler,
  setDevHeaders,
  type HandlerContext,
} from "./base-handler.js";
import { UIHandler } from "./ui-handler.js";
import { UIXHandler } from "./uix-handler.js";
import { TSHandler } from "./ts-handler.js";
import { getLogger, relPath } from "../../internal/logger.js";
import { markSource } from "../request-context.js";
import { fileNotFoundError } from "../../internal/fs-errors.js";

const log = getLogger("js");

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
          log.debug(`${url} -> ${url.replace(/\.js$/, alt.ext)} (file: ${relPath(altPath)})`);
          return await alt.handler();
        } catch {
          // Try next alternative
          log.debug(`${url}: no ${alt.ext} alternative`);
        }
      }

      // No alternatives found: the caller answers 404 (ENOENT) and logs it once.
      throw fileNotFoundError(`File not found: ${url} (tried .js, .ts, .ui, .uix)`);
    }

    // .js file exists, process it normally
    const source = await fs.readFile(filePath, "utf-8");

    // Debug: Check for bare imports (including simple npm packages like bcryptjs)
    const bareImportPattern =
      /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/;
    const simpleNpmPattern =
      /(?:import|from|export).*['"]([a-zA-Z][a-zA-Z0-9_-]*)[^'"]*['"]/;
    if (bareImportPattern.test(source) || simpleNpmPattern.test(source)) {
      log.debug(`Found imports in ${url}, rewriting...`);
      // Log the actual imports found
      const importMatches = source.matchAll(
        /(?:import|from)\s+['"]([^'"]+)['"]/g,
      );
      for (const match of importMatches) {
        log.debug(`Found import: ${match[1]}`);
      }
    }

    const cssHandled = rewriteCssImports(source);
    const rewritten = await rewriteImports(
      cssHandled,
      filePath,
      this.context.resolver,
    );

    // Debug: Verify no bare imports remain after rewriting
    if (bareImportPattern.test(rewritten)) {
      log.warn(`bare imports still present in ${url} after rewriting`);
      const matches = Array.from(
        rewritten.matchAll(
          /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)[^'"]*['"]/g,
        ),
      );
      for (const match of matches.slice(0, 3)) {
        log.warn(`unresolved import in ${url}: ${match[1]}`);
      }
    }

    markSource("compiled", res);
    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(rewritten);
  }
}
