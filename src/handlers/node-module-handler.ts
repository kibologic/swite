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

      // Try app root node_modules first
      const appNodeModulesPath = path.join(this.context.root, urlPath);
      console.log(
        chalk.blue(`[node_modules] Trying app path: ${appNodeModulesPath}`),
      );
      try {
        // Try to resolve symlinks first (realpath works even if path is a symlink)
        // If realpath fails, the path doesn't exist
        const resolvedPath = await fs.realpath(appNodeModulesPath);
        console.log(chalk.blue(`[node_modules] Resolved to: ${resolvedPath}`));
        // Verify the resolved path exists
        await fs.access(resolvedPath);
        filePath = resolvedPath;
        console.log(chalk.green(`[node_modules] ✓ Found in app: ${urlPath}`));
      } catch (err) {
        console.log(
          chalk.yellow(
            `[node_modules] App path failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        // Try workspace root node_modules
        if (workspaceRoot) {
          const workspaceNodeModulesPath = path.join(workspaceRoot, urlPath);
          console.log(
            chalk.blue(
              `[node_modules] Trying workspace path: ${workspaceNodeModulesPath}`,
            ),
          );
          try {
            // Try to resolve symlinks first (realpath works even if path is a symlink)
            const resolvedPath = await fs.realpath(workspaceNodeModulesPath);
            console.log(
              chalk.blue(`[node_modules] Resolved to: ${resolvedPath}`),
            );
            // Verify the resolved path exists
            await fs.access(resolvedPath);
            filePath = resolvedPath;
            console.log(
              chalk.green(`[node_modules] ✓ Found in workspace: ${urlPath}`),
            );
          } catch (err2) {
            console.log(
              chalk.yellow(
                `[node_modules] Workspace path failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
              ),
            );
            // Try swiss-lib monorepo node_modules (dynamically found)
            const { findSwissLibMonorepo } = await import("../utils/package-finder.js");
            const swissLib = await findSwissLibMonorepo(this.context.root);
            if (swissLib) {
              const swissNodeModulesPath = path.join(swissLib, urlPath);
              console.log(
                chalk.blue(
                  `[node_modules] Trying swiss-lib path: ${swissNodeModulesPath}`,
                ),
              );
              try {
                // Try to resolve symlinks first (realpath works even if path is a symlink)
                const resolvedPath = await fs.realpath(swissNodeModulesPath);
                console.log(
                  chalk.blue(`[node_modules] Resolved to: ${resolvedPath}`),
                );
                // Verify the resolved path exists
                await fs.access(resolvedPath);
                filePath = resolvedPath;
                console.log(
                  chalk.green(
                    `[node_modules] ✓ Found in swiss-lib monorepo: ${urlPath}`,
                  ),
                );
              } catch (err3) {
                console.log(
                  chalk.yellow(
                    `[node_modules] swiss-lib path failed: ${err3 instanceof Error ? err3.message : String(err3)}`,
                  ),
                );
                // File not found in any location, will trigger case-insensitive search below
                filePath = path.join(this.context.root, urlPath);
              }
            } else {
              // File not found in any location, will trigger case-insensitive search below
              filePath = path.join(this.context.root, urlPath);
            }
          }
        } else {
          filePath = path.join(this.context.root, urlPath);
        }
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
    const after = url.slice(prefix.length);
    if (!after) return null;
    // First segment is package name (or @scope/name for scoped packages)
    const firstSlash = after.indexOf("/");
    const pkgName = firstSlash === -1 ? after : after.slice(0, firstSlash);
    if (!pkgName || pkgName === "." || pkgName === "..") return null;
    // jsDelivr +esm serves ESM build; works for reflect-metadata and most npm packages
    return `https://cdn.jsdelivr.net/npm/${pkgName}/+esm`;
  }
}
