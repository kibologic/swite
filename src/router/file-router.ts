/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { RouteDefinition } from "@swissjs/core";
import { RouteScanner } from "@swissjs/plugin-file-router/core";
import { createFileWatcher } from "@swissjs/plugin-file-router/dev";
import { HMREngine } from "../hmr.js";
import { findWorkspaceRoot } from "../utils/workspace.js";

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
    const workspaceRoot = await findWorkspaceRoot(config.root);
    const appRoot = config.root;

    // Initialize route scanner
    result.routeScanner = new RouteScanner({
      routesDir: "./src/pages",
      extensions: [".ui", ".uix"],
      layouts: true,
      lazyLoading: true,
    });

          // Scan routes from multiple locations:
          // 1. App's pages directory (apps/alpine/src/pages)
          // 2. SKLTN's pages directory (framework/skltn/src/pages) - for reusable auth pages
    const routesToScan: string[] = [];

    // App pages
    const appPagesDir = path.join(appRoot, "src", "pages");
    try {
      await fs.access(appPagesDir);
      routesToScan.push(appPagesDir);
      console.log(chalk.gray(`  📄 Scanning app routes from ${appPagesDir}`));
    } catch {
      // pages directory doesn't exist, skip
    }

    // SKLTN pages (if workspace root exists)
    if (workspaceRoot && workspaceRoot !== appRoot) {
      // Try framework/skltn first (new location), then fallback to lib/skltn (legacy)
      const skltnPagesDir = path.join(
        workspaceRoot,
        "framework",
        "skltn",
        "src",
        "pages",
      );
      const legacySkltnPagesDir = path.join(
        workspaceRoot,
        "lib",
        "skltn",
        "src",
        "pages",
      );
      
      try {
        await fs.access(skltnPagesDir);
        routesToScan.push(skltnPagesDir);
        console.log(
          chalk.gray(`  📄 Scanning SKLTN routes from ${skltnPagesDir}`),
        );
      } catch {
        // Try legacy location
        try {
          await fs.access(legacySkltnPagesDir);
          routesToScan.push(legacySkltnPagesDir);
          console.log(
            chalk.gray(`  📄 Scanning SKLTN routes from ${legacySkltnPagesDir} (legacy)`),
          );
        } catch {
          // pages directory doesn't exist, skip
        }
      }
    }

    // Scan all route directories
    for (const pagesDir of routesToScan) {
      try {
        const scannedRoutes = await result.routeScanner.scanRoutes(pagesDir);
        result.routes.push(...scannedRoutes);
        console.log(
          chalk.green(
            `  ✓ Found ${scannedRoutes.length} routes in ${pagesDir}`,
          ),
        );
      } catch (error) {
        console.warn(
          chalk.yellow(`  ⚠ Failed to scan routes from ${pagesDir}:`),
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
        console.log(chalk.yellow(`  🔄 Route file changed: ${filePath}`));
        // Rescan routes
        result.routes = [];
        for (const pagesDir of routesToScan) {
          try {
            const scannedRoutes =
              await result.routeScanner!.scanRoutes(pagesDir);
            result.routes.push(...scannedRoutes);
          } catch (error) {
            console.warn(`Failed to rescan routes:`, error);
          }
        }
        // Notify HMR about route changes
        config.hmr.notifyChange(filePath);
      });

      console.log(
        chalk.green(
          `  ✓ File router initialized with ${result.routes.length} routes`,
        ),
      );
    } else {
      console.log(
        chalk.gray(`  ⚠ No pages directories found, file router disabled`),
      );
    }
  } catch (error) {
    console.warn(chalk.yellow(`  ⚠ File router setup failed:`), error);
    // Continue without file router
  }

  return result;
}
