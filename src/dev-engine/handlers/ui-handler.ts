/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { BaseHandler, setDevHeaders, type HandlerContext } from "./base-handler.js";
import { getLogger, relPath } from "../../internal/logger.js";
import { fileNotFoundError } from "../../internal/fs-errors.js";

const log = getLogger("ui");

export class UIHandler extends BaseHandler {
  constructor(context: HandlerContext) {
    super(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    log.debug(`${url} -> ${relPath(filePath)}`);

    try {
      await fs.access(filePath);
    } catch {
      throw fileNotFoundError(`File not found: ${url}`);
    }

    await this.compileAndServe(url, filePath, res, ".ui");
  }
}
