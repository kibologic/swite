/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { RouteDefinition } from "@kibologic/core";
import { RouteScanner } from "@kibologic/plugin-file-router/core";
import { createFileWatcher } from "@kibologic/plugin-file-router/dev";
import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ModuleResolver } from "./resolver.js";
import { HMREngine } from "./hmr.js";
import chalk from "chalk";
import { setupMiddleware } from "./middleware/middleware-setup.js";
import { buildSymlinkRegistry } from "./resolver/symlink-registry.js";
import { findSwissLibMonorepo } from "./utils/package-finder.js";

export interface SwiteConfig {
  root: string;
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
    this.hmr = new HMREngine(this.config.root, this.config.hmrPort);
  }

  // CG-03: find workspace root by walking up from startDir
  private async findWorkspaceRoot(startDir: string): Promise<string | null> {
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

    // CG-03: Build symlink registry before serving any requests.
    // Maps realpath(node_modules/pkg symlink) → /node_modules/pkg browser URL
    // so toUrl() can map absolute filesystem paths back to browser URLs.
    console.time("Symlink Registry");
    try {
      const nodeModulesDirs: string[] = [
        path.join(this.config.root, "node_modules"),
      ];
      const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
      if (workspaceRoot) {
        nodeModulesDirs.push(path.join(workspaceRoot, "node_modules"));
      }
      const swissLib = await findSwissLibMonorepo(this.config.root);
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
    const middlewareResult = await setupMiddleware(this.app, {
      root: this.config.root,
      publicDir: this.config.publicDir,
      resolver: this.resolver,
      hmr: this.hmr,
    });
    this.routes = middlewareResult.routes;
    this.routeScanner = middlewareResult.routeScanner;
    this.routeWatcher = middlewareResult.routeWatcher;
    console.timeEnd("Middleware Setup");

    // Start HMR
    console.time("HMR Start");
    await this.hmr.initialize();
    await this.hmr.start();
    console.timeEnd("HMR Start");

    // Start HTTP server
    // Use 0.0.0.0 to bind to all interfaces (IPv4 and IPv6)
    const bindHost = this.config.host === "localhost" ? "0.0.0.0" : this.config.host;
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
