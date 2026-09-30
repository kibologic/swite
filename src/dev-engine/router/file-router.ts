/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RouteDefinition } from "@swissjs/core";
import { RouteScanner } from "@swissjs/plugin-file-router/core";
import { createFileWatcher } from "@swissjs/plugin-file-router/dev";
import { HMREngine } from "../hmr/hmr.js";
import { getLogger, relPath } from "../../internal/logger.js";

const log = getLogger("router");

export interface FileRouterConfig {
  root: string;
  hmr: HMREngine;
}

export interface FileRouterResult {
  routeScanner: RouteScanner | null;
  routeWatcher: Awaited<ReturnType<typeof createFileWatcher>> | null;
  routes: RouteDefinition[];
}

/**
 * Setup file-based routing
 * Scans for route files in pages/ directories and watches for changes
 */
export async function setupFileRouter(
  config: FileRouterConfig,
): Promise<FileRouterResult> {
  const result: FileRouterResult = {
    routeScanner: null,
    routeWatcher: null,
    routes: [],
  };

  try {
    const appRoot = config.root;

    // Initialize route scanner
    result.routeScanner = new RouteScanner({
      routesDir: "./src/pages",
      extensions: [".ui", ".uix"],
      layouts: true,
      lazyLoading: true,
    });

    const routesToScan: string[] = [];

    // App pages directory
    const appPagesDir = path.join(appRoot, "src", "pages");
    try {
      await fs.access(appPagesDir);
      routesToScan.push(appPagesDir);
      log.debug(`Scanning app routes from ${relPath(appPagesDir)}`);
    } catch {
      // pages directory doesn't exist, skip
    }

    // Scan all route directories
    for (const pagesDir of routesToScan) {
      try {
        const scannedRoutes = await result.routeScanner.scanRoutes(pagesDir);
        result.routes.push(...scannedRoutes);
        log.debug(
          `Found ${scannedRoutes.length} routes in ${relPath(pagesDir)}`,
        );
      } catch (error) {
        log.warn(
          `Failed to scan routes from ${relPath(pagesDir)}:`,
          error,
        );
      }
    }

    // Setup file watcher for route changes
    if (routesToScan.length > 0) {
      // Watch the first pages directory (can be extended to watch multiple)
      result.routeWatcher = await createFileWatcher({
        directory: routesToScan[0],
        extensions: [".ui", ".uix"],
      });

      result.routeWatcher.on("change", async (filePath) => {
        log.debug(`Route file changed: ${relPath(filePath)}`);
        // Rescan routes
        result.routes = [];
        for (const pagesDir of routesToScan) {
          try {
            const scannedRoutes =
              await result.routeScanner!.scanRoutes(pagesDir);
            result.routes.push(...scannedRoutes);
          } catch (error) {
            log.warn(`Failed to rescan routes:`, error);
          }
        }
        // Notify HMR about route changes
        config.hmr.notifyChange(filePath);
      });

      log.debug(
        `File router initialized with ${result.routes.length} routes`,
      );
    } else {
      log.debug(
        `No pages directories found, file router disabled`,
      );
    }
  } catch (error) {
    log.warn(`File router setup failed:`, error);
    // Continue without file router
  }

  return result;
}
