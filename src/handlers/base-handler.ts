/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { ModuleResolver } from "../resolver.js";
import { resolveFilePath } from "../utils/file-path-resolver.js";

export interface HandlerContext {
  resolver: ModuleResolver;
  root: string;
  workspaceRoot: string | null;
}

/**
 * Set cache-busting headers for development
 */
export function setDevHeaders(res: Response) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

/**
 * Base handler utilities
 */
export class BaseHandler {
  constructor(protected context: HandlerContext) {}

  protected async resolveFilePath(url: string): Promise<string> {
    return resolveFilePath(url, this.context.root, this.context.workspaceRoot);
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
