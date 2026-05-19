/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Express, Request, Response, NextFunction } from "express";
import type { RouteDefinition } from "@kibologic/core";
import { RouteScanner } from "@kibologic/plugin-file-router/core";
import { createFileWatcher } from "@kibologic/plugin-file-router/dev";
import chalk from "chalk";
import path from "path";
import fs from "fs/promises";
import { ModuleResolver } from "../resolver.js";
import { UIHandler } from "../handlers/ui-handler.js";
import { UIXHandler } from "../handlers/uix-handler.js";
import { TSHandler } from "../handlers/ts-handler.js";
import { JSHandler } from "../handlers/js-handler.js";
import { MJSHandler } from "../handlers/mjs-handler.js";
import { NodeModuleHandler } from "../handlers/node-module-handler.js";
import { setupStaticFiles, setupSPAFallback } from "./static-files.js";
import { setupHMRRoutes } from "./hmr-routes.js";
import {
  setupFileRouter,
  type FileRouterResult,
} from "../router/file-router.js";
import { HMREngine } from "../hmr.js";
import { findWorkspaceRoot } from "../utils/workspace.js";
import { loadImportMap } from "../utils/generate-import-map.js";
import { loadEnv } from "../env.js";

export interface MiddlewareConfig {
  root: string;
  workspaceRoot?: string | null;
  publicDir: string;
  resolver: ModuleResolver;
  hmr: HMREngine;
}

export interface MiddlewareResult {
  routes: RouteDefinition[];
  routeScanner: RouteScanner | null;
  routeWatcher: Awaited<ReturnType<typeof createFileWatcher>> | null;
}

const SOURCE_EXTS = new Set([".ui", ".uix", ".ts", ".mjs"]);

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && (error as any).code === "ENOENT") ||
      ("errno" in error && (error as any).errno === -4058))
  );
}

function sendSourceError(res: Response, error: unknown, fullPath: string): void {
  if (res.headersSent) return;
  const status = isFileNotFoundError(error) ? 404 : 500;
  res.status(status).setHeader("Content-Type", "text/plain");
  res.send(
    isFileNotFoundError(error)
      ? `File not found: ${fullPath}`
      : `Error loading module: ${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * Setup all middleware for the SWITE server.
 *
 * Middleware registration order (matters for Express):
 *  1. File router + HMR routes
 *  2. /packages source files
 *  3. /src source files (highest priority for that prefix)
 *  4. /lib source files (pre-static guard)
 *  5. .ui/.uix MIME-type guard (belt-and-suspenders for slipped-through requests)
 *  6. /.skltn/modules.css → 204
 *  7. Static file serving (public/, node_modules/, lib/)
 *  8. General source-file transformation (all other paths)
 *  9. SPA fallback
 */
export async function setupMiddleware(
  app: Express,
  config: MiddlewareConfig
): Promise<MiddlewareResult> {
  // ── 1. File router + HMR ───────────────────────────────────────────────────
  const fileRouterResult: FileRouterResult = await setupFileRouter({
    root: config.root,
    hmr: config.hmr,
  });

  setupHMRRoutes(app, {
    hmr: config.hmr,
    routes: fileRouterResult.routes,
  });

  // ── Workspace + import-map setup ───────────────────────────────────────────
  const workspaceRoot = await findWorkspaceRoot(config.root);
  console.log(chalk.blue(`[SWITE] App root: ${config.root}`));
  console.log(chalk.blue(`[SWITE] Workspace root: ${workspaceRoot}`));

  const { join } = await import("node:path");
  const importMapPath = join(config.root, ".swite", "import-map.json");
  const importMap = await loadImportMap(importMapPath);
  if (importMap) {
    config.resolver.setImportMap(importMap);
  } else {
    console.log(chalk.yellow(`[SWITE] No import map at ${importMapPath}, using runtime resolution`));
  }

  // ── Load .env files for import.meta.env inlining ──────────────────────────
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  const env = loadEnv(config.root, mode);

  // ── Create handlers ────────────────────────────────────────────────────────
  const handlerContext = {
    resolver: config.resolver,
    root: config.root,
    workspaceRoot,
    env,
  };

  const uiHandler = new UIHandler(handlerContext);
  const uixHandler = new UIXHandler(handlerContext);
  const tsHandler = new TSHandler(handlerContext);
  const jsHandler = new JSHandler(handlerContext);
  const mjsHandler = new MJSHandler(handlerContext);
  const nodeModuleHandler = new NodeModuleHandler(handlerContext);

  // ── 2. /packages workspace source files ────────────────────────────────────
  app.use("/packages", async (req: Request, res: Response, next: NextFunction) => {
    const rawUrl = req.url?.split("?")[0] || "";
    const fullUrl = "/packages" + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl);

    try {
      if (fullUrl.endsWith(".ts") && !fullUrl.endsWith(".d.ts")) {
        await tsHandler.handle(fullUrl, res);
        if (res.headersSent) return;
      } else if (fullUrl.endsWith(".js") || fullUrl.endsWith(".mjs")) {
        await (fullUrl.endsWith(".js") ? jsHandler : mjsHandler).handle(fullUrl, res);
        if (res.headersSent) return;
      }
    } catch (error) {
      console.error(chalk.red(`[/packages] Error ${fullUrl}:`), error);
      if (!res.headersSent) res.status(500).setHeader("Content-Type", "text/plain").send(String(error));
      return;
    }
    next();
  });

  // ── 3. /src source files ───────────────────────────────────────────────────
  // When Express mounts at "/src", req.url is relative (e.g. "/index.ui")
  app.use("/src", async (req: Request, res: Response, next: NextFunction) => {
    const relativeUrl = req.url.split("?")[0];
    const fullPath = "/src" + relativeUrl;

    if (relativeUrl.endsWith(".ui")) {
      if (res.headersSent) return;
      if (req.method === "HEAD") {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        return res.status(200).end();
      }
      try {
        await uiHandler.handle(fullPath, res);
        if (!res.headersSent) res.status(500).send("Internal server error: handler did not send response");
      } catch (error) {
        console.error(chalk.red(`[/src] .ui error ${fullPath}:`), error);
        sendSourceError(res, error, fullPath);
      }
      return;
    }

    if (relativeUrl.endsWith(".uix")) {
      try {
        await uixHandler.handle(fullPath, res);
        if (!res.headersSent) res.status(500).setHeader("Content-Type", "text/plain").send("Error loading module");
      } catch (error) {
        console.error(chalk.red(`[/src] .uix error ${fullPath}:`), error);
        sendSourceError(res, error, fullPath);
      }
      return;
    }

    if (relativeUrl.endsWith(".ts") && !relativeUrl.endsWith(".d.ts")) {
      try {
        await tsHandler.handle(fullPath, res);
        if (!res.headersSent) res.status(500).setHeader("Content-Type", "text/plain").send("Error loading module");
      } catch (error) {
        console.error(chalk.red(`[/src] .ts error ${fullPath}:`), error);
        sendSourceError(res, error, fullPath);
      }
      return;
    }

    if (relativeUrl.endsWith(".js") || relativeUrl.endsWith(".mjs")) {
      try {
        await (relativeUrl.endsWith(".js") ? jsHandler : mjsHandler).handle(fullPath, res);
        if (res.headersSent) return;
      } catch {
        // fall through to static file serving below
      }
      if (!res.headersSent) return next();
      return;
    }

    // Other files under /src (CSS, images, etc.) — serve as static
    const filePath = path.join(config.root, "src", relativeUrl);
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return next();

      const ext = path.extname(relativeUrl).toLowerCase();
      // Guard: source files should never reach here
      if (SOURCE_EXTS.has(ext) || ext === ".js") {
        res.status(404).setHeader("Content-Type", "text/plain");
        return res.send(`Source file not found: ${fullPath}`);
      }

      const contentTypeMap: Record<string, string> = {
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
      };

      const content = await fs.readFile(filePath);
      res.setHeader("Content-Type", contentTypeMap[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(content);
    } catch {
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${fullPath}`);
    }
  });

  // ── 4. /lib source files (pre-static guard) ────────────────────────────────
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/lib/")) return next();

    const isSource =
      url.endsWith(".ui") ||
      url.endsWith(".uix") ||
      url.endsWith(".ts") ||
      (url.endsWith(".js") && !url.includes("node_modules"));

    if (!isSource) return next();

    res.setHeader("Content-Type", "application/javascript; charset=utf-8");

    try {
      if (url.endsWith(".ui")) { await uiHandler.handle(url, res); return; }
      if (url.endsWith(".uix")) { await uixHandler.handle(url, res); return; }
      // .ts/.js — fall through to general middleware
      return next();
    } catch (error) {
      console.error(chalk.red(`[/lib] Error ${url}:`), error);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  });

  // ── 5. .ui/.uix MIME guard (belt-and-suspenders) ──────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];
    if (url.endsWith(".ui") || url.endsWith(".uix")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    }
    next();
  });

  // ── 6. /.skltn/modules.css → 204 (dev mode — CSS not bundled) ─────────────
  app.use("/.skltn/modules.css", (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // ── 7. Static file serving ─────────────────────────────────────────────────
  await setupStaticFiles(app, {
    root: config.root,
    publicDir: config.publicDir,
    workspaceRoot: config.workspaceRoot ?? null,
  });

  // ── 8. General source-file transformation ──────────────────────────────────
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];

    // /src is already handled above
    if (url.startsWith("/src")) return next();

    // /lib static files are handled by static middleware; source files handled above
    if (url.startsWith("/lib/")) {
      const isSource =
        url.endsWith(".ui") ||
        url.endsWith(".uix") ||
        url.endsWith(".ts") ||
        (url.endsWith(".js") && !url.includes("node_modules"));
      if (!isSource) return next();
    }

    try {
      if (url.endsWith(".ui")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        if (res.headersSent) return;
        await uiHandler.handle(url, res);
        if (!res.headersSent) res.status(500).send("Internal server error: handler did not send response");
        return;
      }

      if (url.endsWith(".uix")) { await uixHandler.handle(url, res); return; }

      if (url.endsWith(".ts") && !url.endsWith(".d.ts")) { await tsHandler.handle(url, res); return; }

      if ((url.endsWith(".js") || url.endsWith(".mjs")) && url.includes("node_modules")) {
        await nodeModuleHandler.handle(url, res);
        return;
      }

      if (url.endsWith(".js")) { await jsHandler.handle(url, res); return; }

      if (url.endsWith(".mjs")) { await mjsHandler.handle(url, res); return; }

      // Static assets — pass to static middleware
      next();
    } catch (error) {
      console.error(chalk.red(`[middleware] Error ${url}:`), error);
      if (!res.headersSent) {
        res.status(500).send(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  // ── 9. SPA fallback ────────────────────────────────────────────────────────
  await setupSPAFallback(app, {
    root: config.root,
    publicDir: config.publicDir,
  });

  return {
    routes: fileRouterResult.routes,
    routeScanner: fileRouterResult.routeScanner,
    routeWatcher: fileRouterResult.routeWatcher,
  };
}
