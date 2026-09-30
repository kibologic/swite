/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Response } from "express";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { rewriteImports } from "../../resolution/rewriting/import-rewriter.js";
import { BaseHandler, type HandlerContext } from "./base-handler.js";
import { UIHandler } from "./ui-handler.js";
import { UIXHandler } from "./uix-handler.js";
import { TSHandler } from "./ts-handler.js";
import { findWorkspaceRoot } from "../../kernel/workspace.js";
import { findPackage } from "../../kernel/package-finder.js";
import { shouldUseCdnFallback } from "../../resolution/cdn/cdn-fallback.js";
import { getLogger, relPath } from "../../internal/logger.js";
import { classifyFsError, type FsFailureKind } from "../../internal/fs-errors.js";
import { markSource } from "../request-context.js";

const log = getLogger("node_modules");

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

      markSource("node_modules", res);
      let probed = 0;
      const probeFailures: FsFailureKind[] = [];

      // Walk up directory tree from app root to find node_modules at any level
      // (handles pnpm isolated AND hoisted workspace layouts)
      {
        let current = path.resolve(this.context.root);
        const visited = new Set<string>();
        for (let i = 0; i < 8; i++) {
          const candidate = path.join(current, urlPath);
          if (!visited.has(candidate)) {
            visited.add(candidate);
            probed++;
            try {
              const resolvedPath = await fs.realpath(candidate);
              await fs.access(resolvedPath);
              filePath = resolvedPath;
              break;
            } catch (err) {
              // Expected with pnpm layouts: the file lives in only one of the
              // parent node_modules directories. Recorded, not printed.
              probeFailures.push(classifyFsError(err));
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
          log.debug(`${packageName} found via ${location.type}`);

          // Re-use dist -> src fallback for local siblings
          if (location.type !== 'node_modules' && filePath.includes("/dist/")) {
            const srcPath = filePath.replace("/dist/", "/src/").replace(/\.[mc]?js$/, ".ts");
            try {
              await fs.access(srcPath);
              log.debug(`serving local source instead of dist: ${relPath(srcPath)}`);
              filePath = srcPath;

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

      // One summarised line replaces the per-probe chatter.
      log.debug(
        `${url} -> ${relPath(filePath)} (probed ${probed}${
          probeFailures.length ? `, misses: ${summariseFailures(probeFailures)}` : ""
        })`,
      );

      // File path is already resolved from above, no need to resolve again

      // Check if file exists, if .js doesn't exist try case-insensitive match and alternatives
      try {
        await fs.access(filePath);
      } catch (error) {
        log.debug(`no exact-case file for ${url}, trying case-insensitive match`);
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
              log.debug(`case-insensitive match: ${requestedName} -> ${caseInsensitiveMatch}`);
              // Verify the file exists with the correct case
              await fs.access(filePath);
              // File found, continue to serve it below
            } else {
              throw new Error("No case-insensitive match found");
            }
          } catch {
            // Directory doesn't exist or no case-insensitive match, try alternatives
            log.debug(`no case-insensitive match for ${url}, trying .ts/.ui/.uix`);
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
                log.debug(
                  `${url} -> ${url.replace(/\.js$/, alt.ext)}`,
                );
                return await alt.handler();
              } catch {
                // Try next alternative
              }
            }

            // No alternatives found - redirect to CDN instead of 500
            this.notFound(url, res);
            return;
          }
        } else {
          // Not a .js file and doesn't exist - try CDN redirect or 404
          this.notFound(url, res);
          return;
        }
      }

      // File exists, process it normally
      // For node_modules files, skip import rewriting - they should work as-is
      // and rewriting can cause issues with package internals
      try {
        const source = await fs.readFile(filePath, "utf-8");

        // Skip import rewriting for node_modules - serve as-is
        // This is safer and faster for third-party packages
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.send(source);
      } catch (error) {
        log.debug(`read failed for ${url} at ${relPath(filePath)}`, error);
        throw error;
      }
    } catch (outerError) {
      // Detail (with stack) at debug; the request log line carries the reason.
      log.debug(`cannot serve ${url}`, outerError);
      const cause = outerError instanceof Error ? outerError.message : String(outerError);
      res.locals["switeNote"] = `cannot serve locally: ${cause.split("\n", 1)[0]}`;
      // Try CDN redirect before giving up with 500
      const cdnRedirect = this.getNodeModuleCdnRedirect(url);
      if (cdnRedirect) {
        markSource("cdn-redirect", res);
        res.redirect(302, cdnRedirect);
        return;
      }
      res.status(404).setHeader("Content-Type", "text/plain").send(
        `Module not found: ${url}. ${outerError instanceof Error ? outerError.message : String(outerError)}`,
      );
    }
  }

  /** Not found locally: redirect to the CDN when allowed, otherwise 404. */
  private notFound(url: string, res: Response): void {
    const cdnRedirect = this.getNodeModuleCdnRedirect(url);
    if (cdnRedirect) {
      markSource("cdn-redirect", res);
      res.locals["switeNote"] = "not found locally, redirected to CDN";
      res.redirect(302, cdnRedirect);
      return;
    }
    res.locals["switeNote"] = "module not found";
    res.status(404).send(`Module not found: ${url}`);
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

    // Never redirect internal/private scoped packages to public CDNs
    const internalScopes = this.context.userConfig?.internalScopes || [];
    const isInternal = internalScopes.some(scope => pkgName === scope || pkgName.startsWith(scope + "/"));
    if (isInternal) {
      log.warn(`internal-scope package ${pkgName} is not installed locally and must not be served from the CDN`);
      return null;
    }

    if (!shouldUseCdnFallback(pkgName)) return null;
    // jsDelivr +esm serves ESM build; works for reflect-metadata and most npm packages
    return `https://cdn.jsdelivr.net/npm/${pkgName}/+esm`;
  }
}

/** Summarise probe failures by cause, e.g. "3 missing, 1 permission". */
function summariseFailures(failures: FsFailureKind[]): string {
  const counts = new Map<FsFailureKind, number>();
  for (const f of failures) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n} ${kind}`).join(", ");
}
