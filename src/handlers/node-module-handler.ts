/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { rewriteImports } from "../import-rewriter.js";
import { BaseHandler, type HandlerContext } from "./base-handler.js";
import { UIHandler } from "./ui-handler.js";
import { UIXHandler } from "./uix-handler.js";
import { TSHandler } from "./ts-handler.js";
import { findWorkspaceRoot } from "../utils/workspace.js";
import { findPackage } from "../utils/package-finder.js";

export class NodeModuleHandler extends BaseHandler {
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
    try {
      // Special case: reflect-metadata/reflect.js -> Reflect.js (case fix)
      if (url.includes("/reflect-metadata/reflect.js")) {
        url = url.replace("/reflect.js", "/Reflect.js");
      }

      // Handle node_modules paths - try multiple locations
      // URL is like /node_modules/reflect-metadata/Reflect.js
      // We need to remove the leading / and join with the appropriate root
      const urlPath = url.startsWith("/") ? url.slice(1) : url;
      let filePath: string | null = null;
      const workspaceRoot =
        this.context.workspaceRoot ||
        (await findWorkspaceRoot(this.context.root));

      console.log(chalk.blue(`[node_modules] Processing: ${url}`));
      console.log(chalk.blue(`[node_modules] App root: ${this.context.root}`));
      console.log(
        chalk.blue(`[node_modules] Workspace root: ${workspaceRoot || "none"}`),
      );

      // Walk up directory tree from app root to find node_modules at any level
      // (handles pnpm isolated AND hoisted workspace layouts)
      {
        let current = path.resolve(this.context.root);
        const visited = new Set<string>();
        for (let i = 0; i < 8; i++) {
          const candidate = path.join(current, urlPath);
          if (!visited.has(candidate)) {
            visited.add(candidate);
            console.log(chalk.blue(`[node_modules] Trying path: ${candidate}`));
            try {
              const resolvedPath = await fs.realpath(candidate);
              console.log(chalk.blue(`[node_modules] Resolved to: ${resolvedPath}`));
              await fs.access(resolvedPath);
              filePath = resolvedPath;
              console.log(chalk.green(`[node_modules] ✓ Found: ${urlPath}`));
              break;
            } catch (err) {
              console.log(chalk.yellow(`[node_modules] Path failed: ${err instanceof Error ? err.message : String(err)}`));
            }
          }
          const parent = path.dirname(current);
          if (parent === current) break;
          current = parent;
        }
      }
      // CONSOLIDATED DISCOVERY: Use the Generalized Package Finder
      // This follows our "Local-First" priority: Siblings > Local node_modules > Workspace node_modules
      if (!filePath) {
        const urlParts = urlPath.split("/");
        const packageName = urlParts[1].startsWith("@") ? `${urlParts[1]}/${urlParts[2]}` : urlParts[1];
        const remainingPath = urlParts[1].startsWith("@") ? urlParts.slice(3).join("/") : urlParts.slice(2).join("/");

        const location = await findPackage(packageName, this.context.root, workspaceRoot);
        
        if (location) {
          filePath = path.join(location.path, remainingPath);
          console.log(chalk.green(`[node_modules] ✓ Found ${packageName} via ${location.type}: ${filePath}`));
          
          // Re-use dist -> src fallback for local siblings
          if (location.type !== 'node_modules' && filePath.includes("/dist/")) {
            const srcPath = filePath.replace("/dist/", "/src/").replace(/\.[mc]?js$/, ".ts");
            try {
              await fs.access(srcPath);
              console.log(chalk.yellow(`[node_modules] Intercept: Serving local source instead of dist: ${srcPath}`));
              filePath = srcPath;
              
              // If we're serving a .ts file instead of .js, we must use the TS handler
              if (srcPath.endsWith(".ts")) {
                return await this.tsHandler.handle(url.replace(/\.[mc]?js$/, ".ts"), res);
              }
            } catch { /* Fallback to original filePath */ }
          }
        }
      }

      if (!filePath) {
        filePath = path.join(this.context.root, urlPath);
      }

      console.log(
        chalk.gray(`[node_modules] Resolving: ${url} -> ${filePath}`),
      );

      // File path is already resolved from above, no need to resolve again

      // Check if file exists, if .js doesn't exist try case-insensitive match and alternatives
      try {
        await fs.access(filePath);
      } catch (error) {
        console.log(
          chalk.yellow(
            `[node_modules] File not found at ${filePath}, trying case-insensitive match...`,
          ),
        );
        // File doesn't exist with exact case, try case-insensitive match (for Reflect.js vs reflect.js)
        if (url.endsWith(".js")) {
          const dir = path.dirname(filePath);
          const requestedName = path.basename(filePath);
          try {
            // Resolve directory symlink (for pnpm)
            const resolvedDir = await fs.realpath(dir).catch(() => dir);
            // Check if directory exists first
            await fs.access(resolvedDir);
            const files = await fs.readdir(resolvedDir);
            const caseInsensitiveMatch = files.find(
              (f) => f.toLowerCase() === requestedName.toLowerCase(),
            );
            if (caseInsensitiveMatch) {
              filePath = path.join(resolvedDir, caseInsensitiveMatch);
              console.log(
                chalk.yellow(
                  `[node_modules] Case-insensitive match: ${requestedName} -> ${caseInsensitiveMatch}`,
                ),
              );
              // Verify the file exists with the correct case
              await fs.access(filePath);
              // File found, continue to serve it below
            } else {
              throw new Error("No case-insensitive match found");
            }
          } catch {
            // Directory doesn't exist or no case-insensitive match, try alternatives
            console.log(
              chalk.gray(
                `[node_modules] Case-insensitive match failed for ${url}, trying alternatives...`,
              ),
            );
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
                await fs.access(basePath + alt.ext);
                console.log(
                  chalk.yellow(
                    `[.js→${alt.ext}] ${url} → ${url.replace(/\.js$/, alt.ext)}`,
                  ),
                );
                return await alt.handler();
              } catch {
                // Try next alternative
              }
            }

            // No alternatives found - redirect to CDN instead of 500
            const cdnRedirect = this.getNodeModuleCdnRedirect(url);
            if (cdnRedirect) {
              console.log(chalk.yellow(`[node_modules] Not found locally, redirecting to CDN: ${cdnRedirect}`));
              res.redirect(302, cdnRedirect);
              return;
            }
            res.status(404).send(`Module not found: ${url}`);
            return;
          }
        } else {
          // Not a .js file and doesn't exist - try CDN redirect or 404
          const cdnRedirect = this.getNodeModuleCdnRedirect(url);
          if (cdnRedirect) {
            res.redirect(302, cdnRedirect);
            return;
          }
          res.status(404).send(`Module not found: ${url}`);
          return;
        }
      }

      // File exists, process it normally
      // For node_modules files, skip import rewriting - they should work as-is
      // and rewriting can cause issues with package internals
      try {
        console.log(chalk.blue(`[node_modules] Reading file: ${filePath}`));
        const source = await fs.readFile(filePath, "utf-8");
        console.log(
          chalk.green(
            `[node_modules] ✓ File read successfully, length: ${source.length}`,
          ),
        );

        // Skip import rewriting for node_modules - serve as-is
        // This is safer and faster for third-party packages
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.send(source);
        console.log(chalk.green(`[node_modules] ✓ Served ${url} successfully`));
      } catch (error) {
        console.error(
          chalk.red(`[node_modules] Error processing ${url} at ${filePath}:`),
        );
        console.error(chalk.red(`[node_modules] Error details:`), error);
        if (error instanceof Error) {
          console.error(chalk.red(`[node_modules] Error stack:`), error.stack);
        }
        throw error;
      }
    } catch (outerError) {
      console.error(chalk.red(`[node_modules] FATAL ERROR handling ${url}:`));
      console.error(
        chalk.red(
          `[node_modules] Error type: ${outerError instanceof Error ? outerError.constructor.name : typeof outerError}`,
        ),
      );
      console.error(
        chalk.red(
          `[node_modules] Error message: ${outerError instanceof Error ? outerError.message : String(outerError)}`,
        ),
      );
      if (outerError instanceof Error && outerError.stack) {
        console.error(chalk.red(`[node_modules] Stack trace:`));
        console.error(outerError.stack);
      }
      // Try CDN redirect before giving up with 500
      const cdnRedirect = this.getNodeModuleCdnRedirect(url);
      if (cdnRedirect) {
        console.log(chalk.yellow(`[node_modules] Error handling locally, redirecting to CDN: ${cdnRedirect}`));
        res.redirect(302, cdnRedirect);
        return;
      }
      res.status(404).setHeader("Content-Type", "text/plain").send(
        `Module not found: ${url}. ${outerError instanceof Error ? outerError.message : String(outerError)}`,
      );
    }
  }

  /**
   * Get CDN URL for a /node_modules/... request when the file is not found locally.
   * Uses jsDelivr (+esm) for reliable ESM delivery; esm.sh can return 500 for some packages.
   * e.g. /node_modules/reflect-metadata/Reflect.js -> https://cdn.jsdelivr.net/npm/reflect-metadata/+esm
   */
  private getNodeModuleCdnRedirect(url: string): string | null {
    const prefix = "/node_modules/";
    if (!url.startsWith(prefix)) return null;

    // For nested paths like /node_modules/@scope/pkg/node_modules/dep/file.js,
    // find the LAST node_modules segment and extract the package name from there.
    const lastNodeModulesIdx = url.lastIndexOf("/node_modules/");
    const after = url.slice(lastNodeModulesIdx + prefix.length);
    if (!after) return null;

    // Extract package name: handle @scope/name and plain-name
    let pkgName: string;
    if (after.startsWith("@")) {
      // Scoped package: need TWO path segments — @scope/name
      const secondSlash = after.indexOf("/", after.indexOf("/") + 1);
      pkgName = secondSlash === -1 ? after : after.slice(0, secondSlash);
    } else {
      const firstSlash = after.indexOf("/");
      pkgName = firstSlash === -1 ? after : after.slice(0, firstSlash);
    }

    if (!pkgName || pkgName === "." || pkgName === "..") return null;

    // BLACKLIST: Never redirect "internal" or "private" scoped packages to public CDNs
    const internalScopes = this.context.userConfig?.internalScopes || [];
    const isInternal = internalScopes.some(scope => pkgName === scope || pkgName.startsWith(scope + "/"));

    if (isInternal) {
      console.log(chalk.red(`[node_modules] CDN Blocked: Internal scope package ${pkgName} cannot be served from jsDelivr.`));
      return null;
    }

    // jsDelivr +esm serves ESM build; works for reflect-metadata and most npm packages
    return `https://cdn.jsdelivr.net/npm/${pkgName}/+esm`;
  }
}
