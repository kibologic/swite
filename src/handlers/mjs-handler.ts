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
import { JSHandler } from "./js-handler.js";

export class MJSHandler extends BaseHandler {
  private jsHandler: JSHandler;

  constructor(context: HandlerContext) {
    super(context);
    this.jsHandler = new JSHandler(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);

    // Check if .mjs file exists
    try {
      await fs.access(filePath);
    } catch {
      // .mjs doesn't exist, try .js as fallback
      const jsPath = filePath.replace(/\.mjs$/, ".js");
      try {
        await fs.access(jsPath);
        console.log(
          chalk.yellow(
            `[.mjs→.js] ${url} → ${url.replace(/\.mjs$/, ".js")} (file: ${jsPath})`,
          ),
        );
        return await this.jsHandler.handle(url.replace(/\.mjs$/, ".js"), res);
      } catch {
        console.error(
          chalk.red(`[.mjs] File not found: ${url} (tried .mjs, .js)`),
        );
        throw new Error(`File not found: ${url} (tried .mjs, .js)`);
      }
    }

    // .mjs file exists, process it normally
    const source = await fs.readFile(filePath, "utf-8");
    const rewritten = await rewriteImports(
      source,
      filePath,
      this.context.resolver,
    );

    // Set proper MIME type for ES modules (.mjs)
    // According to MDN Web Standards: .mjs files should use "application/javascript"
    setDevHeaders(res);
    res.send(rewritten);
  }
}
