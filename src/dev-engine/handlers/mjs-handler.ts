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
import { JSHandler } from "./js-handler.js";
import { getLogger, relPath } from "../../internal/logger.js";
import { markSource } from "../request-context.js";
import { fileNotFoundError } from "../../internal/fs-errors.js";

const log = getLogger("mjs");

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
        log.debug(`${url} -> ${url.replace(/\.mjs$/, ".js")} (file: ${relPath(jsPath)})`);
        return await this.jsHandler.handle(url.replace(/\.mjs$/, ".js"), res);
      } catch {
        throw fileNotFoundError(`File not found: ${url} (tried .mjs, .js)`);
      }
    }

    // .mjs file exists, process it normally
    const source = await fs.readFile(filePath, "utf-8");
    const cssHandled = rewriteCssImports(source);
    const rewritten = await rewriteImports(
      cssHandled,
      filePath,
      this.context.resolver,
    );

    // Set proper MIME type for ES modules (.mjs)
    // According to MDN Web Standards: .mjs files should use "application/javascript"
    markSource("compiled", res);
    setDevHeaders(res);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(rewritten);
  }
}
