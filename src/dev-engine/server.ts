/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { RouteDefinition } from "@swissjs/core";
import { RouteScanner } from "@swissjs/plugin-file-router/core";
import { createFileWatcher } from "@swissjs/plugin-file-router/dev";
import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ModuleResolver } from "../resolution/resolver.js";
import { HMREngine } from "./hmr/hmr.js";
import chalk from "chalk";
import { setupMiddleware } from "./middleware/middleware-setup.js";
import { buildSymlinkRegistry } from "../resolution/symlink-registry.js";
import { findSwissLibMonorepo } from "../kernel/package-finder.js";
import { loadUserConfig } from "../config/config-loader.js";

export interface SwiteConfig {
  root: string;
  // Workspace/monorepo root. When set, Swite will use this for resolving
  // node_modules, workspace packages, and import-map generation.
  // This avoids relying on auto-detection (pnpm-workspace.yaml) which may not
  // exist in some deployment contexts.
  rootDir?: string;
  publicDir: string;
  port: number;
  host: string;
  open: boolean;
  hmrPort?: number; // Optional HMR WebSocket port
}

export class SwiteServer {
  private app = express();
  private resolver: ModuleResolver;
  private hmr: HMREngine;
  private config: SwiteConfig;
  private routeScanner: RouteScanner | null = null;
  private routeWatcher: Awaited<ReturnType<typeof createFileWatcher>> | null =
    null;
  private routes: RouteDefinition[] = [];

  constructor(config: Partial<SwiteConfig> = {}) {
    this.config = {
      root: process.cwd(),
      publicDir: "public",
      port: 3000,
      host: "localhost",
      open: true,
      ...config,
    };

    this.resolver = new ModuleResolver(this.config.root);
    // Security (R-002): build the HMR allowed-origin list from the dev server
    // host+port so the WebSocket server can reject cross-origin connections.
    // When host is "localhost" we also add the numeric loopback form and vice
    // versa — browsers send whichever name the user typed in the address bar.
    const devOrigins = this.buildHmrAllowedOrigins();
    this.hmr = new HMREngine(this.config.root, this.config.hmrPort, devOrigins);
  }

  /**
   * Build the list of origins that are allowed to open an HMR WebSocket.
   * Always includes both the configured host and its loopback alias so the
   * browser can connect regardless of whether the dev typed "localhost" or
   * "127.0.0.1" in the address bar.
   */
  private buildHmrAllowedOrigins(): string[] {
    const { host, port } = this.config;
    const origins: string[] = [];
    const add = (h: string) => origins.push(`http://${h}:${port}`);

    add(host);

    // When the dev host is either loopback alias, also allow the other form.
    if (host === "localhost") add("127.0.0.1");
    else if (host === "127.0.0.1") add("localhost");

    return origins;
  }

  // CG-03: find workspace root by walking up from startDir
  private async findWorkspaceRoot(startDir: string): Promise<string | null> {
    if (this.config.rootDir) {
      return path.resolve(this.config.rootDir);
    }
    let current = startDir;
    for (let i = 0; i < 6; i++) {
      try {
        await fs.access(path.join(current, "pnpm-workspace.yaml"));
        return current;
      } catch {}
      try {
        const pkgJson = JSON.parse(
          await fs.readFile(path.join(current, "package.json"), "utf-8")
        );
        if (pkgJson.workspaces) return current;
      } catch {}
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  async start() {
    const startTime = Date.now();
    console.log(chalk.cyan("\n⚡ SWITE - SWISS Development Server\n"));
    console.time("Startup");

    // Load user config (swiss.config.ts) so internalScopes etc. flow into handlers
    const userConfig = await loadUserConfig(this.config.root);

    // CG-03: Build symlink registry before serving any requests.
    // Maps realpath(node_modules/pkg symlink) → /node_modules/pkg browser URL
    // so toUrl() can map absolute filesystem paths back to browser URLs.
    console.time("Symlink Registry");
    try {
      const nodeModulesDirs: string[] = [
        path.join(this.config.root, "node_modules"),
        // Also scan the server package's own node_modules (one level up from the
        // app root, e.g. apps/server/node_modules) — pnpm places workspace package
        // symlinks there, not in the app root's node_modules subfolder.
        path.join(path.dirname(this.config.root), "node_modules"),
      ];
      const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
      if (workspaceRoot) {
        nodeModulesDirs.push(path.join(workspaceRoot, "node_modules"));
      }
      const swissLib = await findSwissLibMonorepo(this.config.root, userConfig?.siblingRepositories);
      if (swissLib) {
        nodeModulesDirs.push(path.join(swissLib, "node_modules"));
      }
      await buildSymlinkRegistry(nodeModulesDirs);
    } catch (err: any) {
      console.warn(`[SWITE] Symlink registry build failed: ${err.message}`);
    }
    console.timeEnd("Symlink Registry");

    // Setup middleware
    console.time("Middleware Setup");
    const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
    const middlewareResult = await setupMiddleware(this.app, {
      root: this.config.root,
      workspaceRoot,
      publicDir: this.config.publicDir,
      resolver: this.resolver,
      hmr: this.hmr,
      userConfig,
    });
    this.routes = middlewareResult.routes;
    this.routeScanner = middlewareResult.routeScanner;
    this.routeWatcher = middlewareResult.routeWatcher;
    console.timeEnd("Middleware Setup");

    // Start HMR — dev-only. HMR recompiles and pushes source over an
    // unauthenticated WebSocket, which has no place in a production deployment.
    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      console.time("HMR Start");
      await this.hmr.initialize();
      await this.hmr.start(userConfig?.excludeFromHmr);
      console.timeEnd("HMR Start");
    } else {
      console.log(chalk.gray("[SWITE] NODE_ENV=production — HMR disabled"));
    }

    // Start HTTP server
    // Security (R-001): honour the requested host literally.
    // The default host is "localhost" which Node binds to the loopback
    // interface only (127.0.0.1 / ::1).  Binding all interfaces (0.0.0.0)
    // must be an explicit opt-in: the developer must set host to "0.0.0.0"
    // in their swite.config.ts or pass --host 0.0.0.0 on the CLI.
    // We never silently rewrite a requested loopback address to 0.0.0.0.
    const bindHost = this.config.host;
    console.time("HTTP Listen");
    await new Promise<void>((resolve) => {
      this.app.listen(this.config.port, bindHost, () => {
        console.timeEnd("HTTP Listen");
        console.timeEnd("Startup");
        console.log(
          chalk.green(
            `  ➜ Local:   http://localhost:${this.config.port}/`,
          ),
        );
        console.log(chalk.gray(`  ➜ Ready in ${Date.now() - startTime}ms\n`));
        resolve();
      });
    });
  }
}
