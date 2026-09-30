/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { BaseHandler, type HandlerContext } from "./base-handler.js";
import { getLogger } from "../../internal/logger.js";

const log = getLogger("uix");

export class UIXHandler extends BaseHandler {
  constructor(context: HandlerContext) {
    super(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    log.debug(`${url}`);
    await this.compileAndServe(url, filePath, res, ".uix");
  }
}
