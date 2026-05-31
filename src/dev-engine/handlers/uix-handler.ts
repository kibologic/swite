/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import chalk from "chalk";
import { BaseHandler, type HandlerContext } from "./base-handler.js";

export class UIXHandler extends BaseHandler {
  constructor(context: HandlerContext) {
    super(context);
  }

  async handle(url: string, res: Response): Promise<void> {
    const filePath = await this.resolveFilePath(url);
    console.log(chalk.blue(`[.uix] ${url}`));
    await this.compileAndServe(url, filePath, res, ".uix");
  }
}
