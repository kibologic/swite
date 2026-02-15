/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import type { RouteDefinition } from "@swissjs/core";
import { RouteScanner } from "@swissjs/plugin-file-router/core";
import { createFileWatcher } from "@swissjs/plugin-file-router/dev";
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

export interface MiddlewareConfig {
  root: string;
  publicDir: string;
  resolver: ModuleResolver;
  hmr: HMREngine;
}

export interface MiddlewareResult {
  routes: RouteDefinition[];
  routeScanner: RouteScanner | null;
  routeWatcher: Awaited<ReturnType<typeof createFileWatcher>> | null;
}

/**
 * Setup all middleware for the SWITE server
 */
export async function setupMiddleware(
  app: Express,
  config: MiddlewareConfig
): Promise<MiddlewareResult> {
  // Initialize file router
  const fileRouterResult: FileRouterResult = await setupFileRouter({
    root: config.root,
    hmr: config.hmr,
  });

  // HMR client injection and routes endpoint
  setupHMRRoutes(app, {
    hmr: config.hmr,
    routes: fileRouterResult.routes,
  });

  // EARLY REQUEST LOGGER - catch ALL requests before any middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalUrl = req.originalUrl || req.url;
    const urlWithoutQuery = originalUrl.split("?")[0];

    // Log EXACT /src/index.ui match (the main app entry point)
    if (urlWithoutQuery === "/src/index.ui") {
      console.log(
        chalk.red(
          `[EARLY LOGGER] ⚡⚡⚡ EXACT /src/index.ui REQUEST: ${req.method} ${originalUrl}`
        )
      );
      console.log(
        chalk.red(`[EARLY LOGGER] urlWithoutQuery: ${urlWithoutQuery}`)
      );
      console.log(
        chalk.red(
          `[EARLY LOGGER] User-Agent: ${req.get("user-agent")?.substring(0, 80)}`
        )
      );
      console.log(chalk.red(`[EARLY LOGGER] Accept: ${req.get("accept")}`));
      console.log(
        chalk.red(
          `[EARLY LOGGER] req.url: ${req.url}, req.originalUrl: ${req.originalUrl}`
        )
      );
      console.log(chalk.red(`[EARLY LOGGER] Headers sent? ${res.headersSent}`));
    }

    // Also log any other /src/ request with .ui (but not /src/index.ui)
    if (
      urlWithoutQuery.startsWith("/src/") &&
      urlWithoutQuery.endsWith(".ui") &&
      urlWithoutQuery !== "/src/index.ui"
    ) {
      console.log(
        chalk.red(
          `[EARLY LOGGER] ⚡ Request received: ${req.method} ${originalUrl}`
        )
      );
      console.log(
        chalk.red(
          `[EARLY LOGGER] User-Agent: ${req.get("user-agent")?.substring(0, 80)}`
        )
      );
      console.log(chalk.red(`[EARLY LOGGER] Accept: ${req.get("accept")}`));
    }
    next();
  });

  // Get workspace root for handlers
  const workspaceRoot = await findWorkspaceRoot(config.root);
  console.log(chalk.blue(`[SWITE] App root: ${config.root}`));
  console.log(chalk.blue(`[SWITE] Detected workspace root: ${workspaceRoot}`));

  // Load pre-resolved import map if available
  const { join } = await import("node:path");
  const importMapPath = join(config.root, ".swite", "import-map.json");
  const importMap = await loadImportMap(importMapPath);
  if (importMap) {
    config.resolver.setImportMap(importMap);
  } else {
    console.log(
      chalk.yellow(
        `[SWITE] No import map found at ${importMapPath}, using runtime resolution`
      )
    );
  }

  // Create handlers
  const handlerContext = {
    resolver: config.resolver,
    root: config.root,
    workspaceRoot,
  };

  const uiHandler = new UIHandler(handlerContext);
  const uixHandler = new UIXHandler(handlerContext);
  const tsHandler = new TSHandler(handlerContext);
  const jsHandler = new JSHandler(handlerContext);
  const mjsHandler = new MJSHandler(handlerContext);
  const nodeModuleHandler = new NodeModuleHandler(handlerContext);

  // Response interceptor middleware - log what's actually being sent
  // This runs for ALL requests to help debug MIME type issues
  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalUrl = req.originalUrl || req.url;
    const urlWithoutQuery = originalUrl.split("?")[0];

    // Log ALL /src requests to see what's happening
    if (urlWithoutQuery.includes("/src/")) {
      console.log(
        chalk.magenta(
          `[REQUEST INTERCEPTOR] Incoming request: ${req.method} ${originalUrl}`
        )
      );
      console.log(
        chalk.magenta(
          `[REQUEST INTERCEPTOR] URL without query: ${urlWithoutQuery}`
        )
      );
    }

    // Only intercept /src/*.ui requests (check URL without query params)
    if (urlWithoutQuery.includes("/src/") && urlWithoutQuery.endsWith(".ui")) {
      console.log(
        chalk.yellow(
          `[RESPONSE INTERCEPTOR] Setting up interceptor for: ${originalUrl}`
        )
      );
      const originalSend = res.send;
      const originalEnd = res.end;
      const originalSetHeader = res.setHeader;

      // Track headers being set
      const headers: Record<string, string | string[]> = {};
      res.setHeader = function (name: string, value: string | string[]) {
        headers[name.toLowerCase()] = value;
        const result = originalSetHeader.call(this, name, value);
        if (name.toLowerCase() === "content-type") {
          console.log(
            chalk.yellow(
              `[RESPONSE INTERCEPTOR] Content-Type set to: ${value} for ${originalUrl}`
            )
          );
        }
        return result;
      };

      // Intercept send() to log final headers
      res.send = function (body?: any) {
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] res.send() called for: ${req.method} ${originalUrl}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] Final Content-Type: ${headers["content-type"] || res.getHeader("content-type") || "NOT SET"}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] All tracked headers: ${JSON.stringify(headers, null, 2)}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] Body type: ${typeof body}, length: ${typeof body === "string" ? body.length : "N/A"}`
          )
        );
        if (typeof body === "string") {
          const preview = body.substring(0, 300);
          const isHTML =
            preview.trim().startsWith("<!") ||
            preview.trim().startsWith("<html");
          console.log(
            chalk.cyan(
              `[RESPONSE INTERCEPTOR] Body starts with: ${preview.substring(0, 50)}...`
            )
          );
          console.log(
            chalk.cyan(`[RESPONSE INTERCEPTOR] Looks like HTML: ${isHTML}`)
          );
        }
        return originalSend.call(this, body);
      };

      // Intercept end() to log final headers
      res.end = function (chunk?: any, encoding?: any) {
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] res.end() called for: ${req.method} ${originalUrl}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] Final Content-Type: ${headers["content-type"] || res.getHeader("content-type") || "NOT SET"}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] All tracked headers: ${JSON.stringify(headers, null, 2)}`
          )
        );
        console.log(
          chalk.cyan(
            `[RESPONSE INTERCEPTOR] Chunk type: ${typeof chunk}, length: ${typeof chunk === "string" ? chunk.length : "N/A"}`
          )
        );
        if (typeof chunk === "string") {
          const preview = chunk.substring(0, 300);
          const isHTML =
            preview.trim().startsWith("<!") ||
            preview.trim().startsWith("<html");
          console.log(
            chalk.cyan(
              `[RESPONSE INTERCEPTOR] Chunk starts with: ${preview.substring(0, 50)}...`
            )
          );
          console.log(
            chalk.cyan(`[RESPONSE INTERCEPTOR] Looks like HTML: ${isHTML}`)
          );
        }
        return originalEnd.call(this, chunk, encoding);
      };
    }

    next();
  });

  // CRITICAL: Handle /packages/ workspace source files FIRST (dist→src fallback in resolveFilePath)
  app.use("/packages", async (req: Request, res: Response, next: NextFunction) => {
    const rawUrl = req.url?.split("?")[0] || "";
    const fullUrl = "/packages" + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl);
    if (fullUrl.endsWith(".ts") && !fullUrl.endsWith(".d.ts")) {
      try {
        await tsHandler.handle(fullUrl, res);
        if (res.headersSent) return;
      } catch (error) {
        console.error(chalk.red(`[MIDDLEWARE /packages] Error .ts ${fullUrl}:`), error);
        if (!res.headersSent) res.status(500).setHeader("Content-Type", "text/plain").send(String(error));
        return;
      }
      return;
    }
    if (fullUrl.endsWith(".js") || fullUrl.endsWith(".mjs")) {
      try {
        await (fullUrl.endsWith(".js") ? jsHandler.handle(fullUrl, res) : mjsHandler.handle(fullUrl, res));
        if (res.headersSent) return;
      } catch (error) {
        console.error(chalk.red(`[MIDDLEWARE /packages] Error .js/.mjs ${fullUrl}:`), error);
        if (!res.headersSent) res.status(500).setHeader("Content-Type", "text/plain").send(String(error));
        return;
      }
      return;
    }
    next();
  });

  // Module transformation middleware
  // MUST be registered before static files and SPA fallback
  // CRITICAL: Register path-specific middleware for /src FIRST to ensure it runs before static middleware
  // Use app.use() for middleware (not app.all() which is for route handlers)
  // The path "/src" will match /src and all subpaths like /src/index.ui
  // IMPORTANT: When Express matches "/src", req.url is the path AFTER /src (e.g., "/index.ui")
  // So we need to reconstruct the full path for the handler
  app.use("/src", async (req: Request, res: Response, next: NextFunction) => {
    // Log ALL requests to /src to debug
    const originalUrl = req.originalUrl || req.url;
    console.log(chalk.blue(`[DEBUG /src] ${req.method} ${originalUrl}`));
    console.log(
      chalk.blue(
        `[DEBUG /src] req.url: ${req.url}, req.originalUrl: ${req.originalUrl || "N/A"}, req.path: ${req.path || "N/A"}`
      )
    );
    console.log(
      chalk.blue(
        `[DEBUG /src] Headers: ${JSON.stringify({ "user-agent": req.get("user-agent")?.substring(0, 50), accept: req.get("accept")?.substring(0, 50) })}`
      )
    );

    // req.url is relative to the mount point, so "/src/index.ui" becomes "/index.ui"
    // We need to reconstruct the full path: "/src" + req.url
    const relativeUrl = req.url.split("?")[0];
    const fullPath = "/src" + relativeUrl;
    const fullUrl = "/src" + req.url; // Include query params

    // Handle .ui files in /src directory FIRST (before static middleware can interfere)
    if (relativeUrl.endsWith(".ui")) {
      console.log(
        chalk.magenta(
          `[MIDDLEWARE /src] ✅ Intercepted .ui request: ${req.method} ${fullUrl}`
        )
      );
      console.log(
        chalk.magenta(
          `[MIDDLEWARE /src] req.url: ${req.url}, fullPath: ${fullPath}`
        )
      );
      console.log(
        chalk.magenta(
          `[MIDDLEWARE /src] Headers sent? ${res.headersSent}, User-Agent: ${req.get("user-agent")?.substring(0, 50)}`
        )
      );
      try {
        if (res.headersSent) {
          console.warn(
            chalk.yellow(
              `[MIDDLEWARE /src] Response already sent for ${fullPath}`
            )
          );
          return;
        }
        // Handle HEAD requests - just send headers, no body
        if (req.method === "HEAD") {
          console.log(
            chalk.blue(
              `[MIDDLEWARE /src] Handling HEAD request for ${fullPath}`
            )
          );
          res.setHeader(
            "Content-Type",
            "application/javascript; charset=utf-8"
          );
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.status(200).end();
          return;
        }
        // Handler expects full path like "/src/index.ui"
        await uiHandler.handle(fullPath, res);
        if (!res.headersSent) {
          console.error(
            chalk.red(
              `[MIDDLEWARE /src] Handler did not send response for ${fullPath}`
            )
          );
          res
            .status(500)
            .send("Internal server error: handler did not send response");
        } else {
          const contentType = res.getHeader("Content-Type");
          console.log(
            chalk.green(
              `[MIDDLEWARE /src] ✅ Successfully sent .ui file: ${fullPath}`
            )
          );
          console.log(
            chalk.green(`[MIDDLEWARE /src] Content-Type header: ${contentType}`)
          );
          console.log(
            chalk.green(
              `[MIDDLEWARE /src] Response headers sent: ${res.headersSent}`
            )
          );
        }
        return; // Don't call next() - response already sent
      } catch (error) {
        console.error(
          chalk.red(`[MIDDLEWARE /src] Error handling .ui file ${fullPath}:`),
          error
        );
        // CRITICAL: Do NOT call next() or throw - send error response directly
        // This prevents the SPA fallback from catching it and serving HTML
        if (!res.headersSent) {
          // Check if it's a file not found error (ENOENT)
          const isFileNotFound =
            error instanceof Error &&
            (("code" in error && error.code === "ENOENT") ||
              ("errno" in error && (error as any).errno === -4058));
          const status = isFileNotFound ? 404 : 500;
          res.status(status).setHeader("Content-Type", "text/plain");
          res.send(
            isFileNotFound
              ? `File not found: ${fullPath}`
              : `Error loading module: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return; // Don't call next() - error response already sent
      }
    }

    // Handle .uix files
    if (relativeUrl.endsWith(".uix")) {
      try {
        await uixHandler.handle(fullPath, res);
        if (!res.headersSent) {
          res.status(500).setHeader("Content-Type", "text/plain");
          res.send("Error loading module");
        }
        return;
      } catch (error) {
        console.error(
          chalk.red(`[MIDDLEWARE /src] Error handling .uix file ${fullPath}:`),
          error
        );
        if (!res.headersSent) {
          // Check if it's a file not found error (ENOENT)
          const isFileNotFound =
            error instanceof Error &&
            (("code" in error && error.code === "ENOENT") ||
              ("errno" in error && (error as any).errno === -4058));
          const status = isFileNotFound ? 404 : 500;
          res.status(status).setHeader("Content-Type", "text/plain");
          res.send(
            isFileNotFound
              ? `File not found: ${fullPath}`
              : `Error loading module: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return;
      }
    }

    // Handle .ts files
    if (relativeUrl.endsWith(".ts") && !relativeUrl.endsWith(".d.ts")) {
      try {
        await tsHandler.handle(fullPath, res);
        if (!res.headersSent) {
          res.status(500).setHeader("Content-Type", "text/plain");
          res.send("Error loading module");
        }
        return;
      } catch (error) {
        console.error(
          chalk.red(`[MIDDLEWARE /src] Error handling .ts file ${fullPath}:`),
          error
        );
        if (!res.headersSent) {
          // Check if it's a file not found error (ENOENT)
          const isFileNotFound =
            error instanceof Error &&
            (("code" in error && error.code === "ENOENT") ||
              ("errno" in error && (error as any).errno === -4058));
          const status = isFileNotFound ? 404 : 500;
          res.status(status).setHeader("Content-Type", "text/plain");
          res.send(
            isFileNotFound
              ? `File not found: ${fullPath}`
              : `Error loading module: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return;
      }
    }

    // Handle .js and .mjs files (they might be source files that need import rewriting)
    if (relativeUrl.endsWith(".js") || relativeUrl.endsWith(".mjs")) {
      // Check if it's a source file that needs processing
      // For now, try the JS handler first - if it fails, it will call next()
      try {
        if (relativeUrl.endsWith(".js")) {
          await jsHandler.handle(fullPath, res);
          if (res.headersSent) return;
        } else {
          await mjsHandler.handle(fullPath, res);
          if (res.headersSent) return;
        }
      } catch (error) {
        // If handler fails, fall through to static file serving
        console.log(
          chalk.gray(
            `[MIDDLEWARE /src] JS handler failed for ${fullPath}, trying static file serving`
          )
        );
      }
      // If handler didn't send response, continue to static file serving
      if (!res.headersSent) {
        next();
        return;
      }
      return;
    }

    // For other files (CSS, images, etc.), serve as static files
    // We need to serve them from the src directory
    const srcPath = path.join(config.root, "src");
    const filePath = path.join(srcPath, relativeUrl);

    try {
      // Check if file exists and is a file (not directory)
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        console.log(
          chalk.gray(
            `[MIDDLEWARE /src] Path is not a file: ${filePath}, passing to next middleware`
          )
        );
        next();
        return;
      }
      console.log(
        chalk.gray(
          `[MIDDLEWARE /src] Serving static file: ${fullPath} from ${filePath}`
        )
      );

      // Read and serve the file directly
      const content = await fs.readFile(filePath);
      const ext = path.extname(relativeUrl).toLowerCase();

      // CRITICAL: Skip source files - they should have been handled by handlers above
      // If we get here with a .js, .ts, .ui, .uix, .mjs file, something went wrong
      if (ext === ".js" || ext === ".ts" || ext === ".ui" || ext === ".uix" || ext === ".mjs") {
        console.error(
          chalk.red(
            `[MIDDLEWARE /src] ⚠️  Attempting to serve source file as static: ${fullPath}`
          )
        );
        // Don't serve it - return 404 or pass to next middleware
        res.status(404).setHeader("Content-Type", "text/plain");
        res.send(`Source file not found: ${fullPath}`);
        return;
      }

      // Set appropriate Content-Type
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

      const contentType = contentTypeMap[ext] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(content);
      console.log(
        chalk.green(
          `[MIDDLEWARE /src] ✅ Served static file: ${fullPath} (${contentType})`
        )
      );
    } catch (error) {
      // File doesn't exist - return 404 directly, don't call next()
      // This prevents SPA fallback from serving HTML
      console.log(
        chalk.gray(
          `[MIDDLEWARE /src] File not found: ${filePath}, returning 404`
        )
      );
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${fullPath}`);
      return;
    }
  });

  // CRITICAL: Register general middleware for /lib/ source files BEFORE static file middleware
  // This ensures /lib/*.ui and /lib/*.uix files are handled by module transformation, not static serving
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];
    // Handle /lib/ source files FIRST before static middleware can intercept them
    if (url.startsWith("/lib/") && (url.endsWith(".ui") || url.endsWith(".uix") || url.endsWith(".ts") || (url.endsWith(".js") && !url.includes("node_modules")))) {
      console.log(
        chalk.magenta(
          `[PRE-STATIC] Handling /lib/ source file: ${url} before static middleware`
        )
      );
      // Set Content-Type explicitly
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      
      // Handle .ui files
      if (url.endsWith(".ui")) {
        try {
          await uiHandler.handle(url, res);
          return; // Response sent
        } catch (error) {
          console.error(chalk.red(`[PRE-STATIC] Error handling .ui file ${url}:`), error);
          if (!res.headersSent) {
            res.status(500).send("Internal server error");
          }
          return;
        }
      }
      
      // Handle .uix files
      if (url.endsWith(".uix")) {
        try {
          await uixHandler.handle(url, res);
          return; // Response sent
        } catch (error) {
          console.error(chalk.red(`[PRE-STATIC] Error handling .uix file ${url}:`), error);
          if (!res.headersSent) {
            res.status(500).send("Internal server error");
          }
          return;
        }
      }
      
      // For .ts/.js files, let general middleware handle them
      return next();
    }
    next();
  });

  // CRITICAL: Add explicit MIME type handler for source files BEFORE static file middleware
  // This ensures .ui/.uix files always get correct Content-Type even if they slip through
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];
    // If this is a source file request, set Content-Type explicitly
    if (url.endsWith(".ui") || url.endsWith(".uix")) {
      // Set Content-Type BEFORE any other middleware can override it
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      console.log(
        chalk.cyan(
          `[MIME FIX] Set Content-Type for ${url} to application/javascript`
        )
      );
    }
    next();
  });

  // Handle .skltn/modules.css requests - return 204 No Content (bundled CSS not available in dev)
  // This prevents 404 errors in console - the client already has fallback logic
  app.use("/.skltn/modules.css", (req: Request, res: Response) => {
    res.status(204).end(); // No Content - bundled CSS not available in dev mode
  });

  // Static file serving - MUST be AFTER /src middleware but BEFORE general middleware
  // This serves static files from public/, node_modules/, and lib/
  // Register it after /src middleware so /src/ requests are handled first
  await setupStaticFiles(app, {
    root: config.root,
    publicDir: config.publicDir,
  });

  // General module transformation middleware for all other paths
  // IMPORTANT: This should NOT catch /src requests - they should be handled by the /src middleware above
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const url = req.url.split("?")[0];
    const fullUrl = req.url;

    // Skip /src requests - they should be handled by the /src middleware above
    if (url.startsWith("/src")) {
      console.log(
        chalk.yellow(
          `[GENERAL MIDDLEWARE] Skipping /src request: ${fullUrl} - should be handled by /src middleware`
        )
      );
      return next(); // Let /src middleware handle it (but it's already registered, so this shouldn't happen)
    }

    // CRITICAL: Handle /lib/ source files FIRST before static middleware can intercept them
    // Source files (.ui, .uix, .ts, .js) in /lib/ MUST be handled by module transformation middleware
    // Static files (CSS, images) in /lib/ can be handled by static middleware
    if (url.startsWith("/lib/")) {
      const isSourceFile =
        url.endsWith(".ui") ||
        url.endsWith(".uix") ||
        url.endsWith(".ts") ||
        (url.endsWith(".js") && !url.includes("node_modules"));
      if (isSourceFile) {
        // CRITICAL: Process source files in /lib/ - they need module transformation
        console.log(
          chalk.magenta(
            `[GENERAL MIDDLEWARE] Processing /lib/ source file: ${fullUrl}`
          )
        );
        // Continue to handle .ui/.uix/.ts/.js files below
        // Don't return next() - we want to handle them here
      } else {
        // Static file - let static middleware handle it
        console.log(
          chalk.cyan(
            `[GENERAL MIDDLEWARE] Skipping /lib/ static file: ${fullUrl} - should be handled by static file middleware`
          )
        );
        return next(); // Let static file middleware handle it
      }
    }

    // Log all requests to help debug routing
    if (url.includes("css") || url.includes("lib")) {
      console.log(
        chalk.gray(
          `[GENERAL MIDDLEWARE] Processing request: ${fullUrl} (url: ${url})`
        )
      );
    }

    // Log ALL requests to .ui files to debug
    if (url.endsWith(".ui")) {
      console.log(
        chalk.magenta(
          `[GENERAL MIDDLEWARE] 🔍 Intercepted .ui request: ${fullUrl} (path: ${url})`
        )
      );
      console.log(
        chalk.magenta(
          `[GENERAL MIDDLEWARE] Headers sent? ${res.headersSent}, Method: ${req.method}, User-Agent: ${req.get("user-agent")?.substring(0, 50)}`
        )
      );
      console.log(
        chalk.magenta(
          `[GENERAL MIDDLEWARE] Request headers: Accept=${req.get("accept")?.substring(0, 100)}`
        )
      );
    }

    try {
      // Handle .ui files (for paths other than /src)
      // CRITICAL: Set MIME type explicitly BEFORE handler to ensure it's correct
      if (url.endsWith(".ui")) {
        console.log(chalk.cyan(`[GENERAL MIDDLEWARE] 🔧 Processing .ui file: ${url}`));
        // Set Content-Type explicitly BEFORE any handler runs
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        
        // Check if response already sent (shouldn't happen, but safety check)
        if (res.headersSent) {
          console.warn(
            chalk.yellow(
              `[GENERAL MIDDLEWARE] ⚠️  Response already sent for ${url}, skipping handler`
            )
          );
          return;
        }
        try {
          console.log(chalk.cyan(`[GENERAL MIDDLEWARE] 🔧 Calling uiHandler.handle(${url})`));
          await uiHandler.handle(url, res);
          // Verify response was sent
          if (!res.headersSent) {
            console.error(
              chalk.red(`[GENERAL MIDDLEWARE] ❌ Handler did not send response for ${url}`)
            );
            res
              .status(500)
              .send("Internal server error: handler did not send response");
          } else {
            const contentType = res.getHeader("Content-Type");
            console.log(
              chalk.green(
                `[GENERAL MIDDLEWARE] ✅ Successfully sent .ui file: ${url} with Content-Type: ${contentType}`
              )
            );
            // CRITICAL: Verify Content-Type is correct
            if (contentType !== "application/javascript; charset=utf-8") {
              console.error(
                chalk.red(
                  `[GENERAL MIDDLEWARE] ⚠️  WRONG Content-Type for ${url}: Expected 'application/javascript; charset=utf-8', got '${contentType}'`
                )
              );
              // Force correct Content-Type
              res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            }
          }
          return; // Don't call next() - response already sent
        } catch (error) {
          console.error(
            chalk.red(`[GENERAL MIDDLEWARE] ❌ Error handling .ui file ${url}:`),
            error
          );
          // Re-throw to be caught by outer catch block
          throw error;
        }
      }

      // Handle .uix files
      if (url.endsWith(".uix")) {
        await uixHandler.handle(url, res);
        return;
      }

      // Handle .ts files
      if (url.endsWith(".ts") && !url.endsWith(".d.ts")) {
        await tsHandler.handle(url, res);
        return;
      }

      // Handle .js/.mjs files from node_modules (rewrite imports)
      if (
        (url.endsWith(".js") || url.endsWith(".mjs")) &&
        url.includes("node_modules")
      ) {
        await nodeModuleHandler.handle(url, res);
        return;
      }

      // Handle .js files (rewrite imports) - including /swiss-packages files
      if (url.endsWith(".js")) {
        // Log when processing /swiss-packages files to debug
        if (url.startsWith("/swiss-packages/")) {
          console.log(
            chalk.cyan(`[middleware] Processing SWISS package: ${url}`)
          );
        }
        await jsHandler.handle(url, res);
        return;
      }

      // Handle .mjs files (ES modules, rewrite imports)
      if (url.endsWith(".mjs")) {
        await mjsHandler.handle(url, res);
        return;
      }

      // Let CSS and other static files pass through to static file serving
      if (
        url.endsWith(".css") ||
        url.endsWith(".png") ||
        url.endsWith(".jpg") ||
        url.endsWith(".jpeg") ||
        url.endsWith(".gif") ||
        url.endsWith(".svg") ||
        url.endsWith(".webp") ||
        url.endsWith(".woff") ||
        url.endsWith(".woff2") ||
        url.endsWith(".ttf") ||
        url.endsWith(".eot")
      ) {
        console.log(
          chalk.cyan(
            `[GENERAL MIDDLEWARE] Passing static file to static middleware: ${fullUrl}`
          )
        );
        return next();
      }

      next();
    } catch (error) {
      console.error(chalk.red(`Error processing ${url}:`), error);
      res
        .status(500)
        .send(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
  });

  // SPA fallback
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
