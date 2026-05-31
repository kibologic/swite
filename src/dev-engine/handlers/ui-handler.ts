/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { BaseHandler, setDevHeaders, type HandlerContext } from "./base-handler.js";

export class UIHandler extends BaseHandler {
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

    await this.compileAndServe(url, filePath, res, ".ui");
  }
}
