/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import { ModuleResolver } from "../../resolution/resolver.js";
import { resolveFilePath } from "../../resolution/path/file-path-resolver.js";

export interface HandlerContext {
  resolver: ModuleResolver;
  root: string;
  workspaceRoot: string | null;
  env: Record<string, string>;
}

/**
 * Set cache-busting headers for development
 */
export function setDevHeaders(res: Response): void {
  // Prevent all caching during development
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
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

  protected async getDependencies(compiled: string): Promise<string[]> {
    const deps: string[] = [];
    const importPattern = /(?:import|from|export).*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(compiled)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith("/") || specifier.startsWith("@")) {
        try {
          const resolved = await this.context.resolver.resolve(specifier, "");
          if (resolved && !resolved.startsWith("http")) {
            deps.push(resolved);
          }
        } catch {
          // ignore resolution errors during dependency tracking
        }
      }
    }
    return deps;
  }
}
