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
import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { ModuleResolver } from "../resolution/resolver.js";
import { HMREngine } from "./hmr/hmr.js";
import { setupMiddleware } from "./middleware/middleware-setup.js";
import { buildSymlinkRegistry } from "../resolution/symlink-registry.js";
import { findSwissLibMonorepo } from "../kernel/package-finder.js";
import { loadUserConfig } from "../config/config-loader.js";
import { getLogger, logger, setLogRoot } from "../internal/logger.js";
import { createRequestLog, type RequestLog } from "./middleware/request-log.js";
import {
  baseInfo,
  formatBanner,
  listeningUrls,
  resolveFrameworkSource,
  safeTarget,
  type SwiteServerInfo,
} from "./server-info.js";
import type { StopSummary } from "./lifecycle.js";
import { SwitePortInUseError, SwiteListenError, assertPortFree } from "./listen-errors.js";

const log = getLogger("server");

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
  /** Requests slower than this are tagged "slow" in the request log. Default 500. */
  slowRequestMs?: number;
  /**
   * Register host routes (for example gateway/API routes that call
   * proxyToPython) on the underlying Express app. Called after the request
   * log and before Swite's own middleware, so these routes win and appear in
   * the request log like any other.
   */
  configureApp?: (app: express.Express) => void;
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
  private httpServer: HttpServer | null = null;
  private sockets = new Set<Socket>();
  private requestLog: RequestLog;
  private startedAt: number | null = null;
  private stopping: Promise<StopSummary> | null = null;
  private serverInfo: SwiteServerInfo;

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
    this.requestLog = createRequestLog({
      slowMs: this.config.slowRequestMs ?? (Number(process.env["SWITE_SLOW_MS"]) || 500),
    });
    this.serverInfo = baseInfo({
      root: this.config.root,
      host: this.config.host,
      port: this.config.port,
    });
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

  /**
   * What this server knows about itself: version, mode, URLs, framework
   * source, ready time. Complete after start(); before that the framework
   * sources read "unresolved" and readyMs is null. The launch banner prints
   * this same object, so a host app can print or serve it too.
   */
  info(): SwiteServerInfo {
    return { ...this.serverInfo };
  }

  async start(): Promise<void> {
    const startTime = Date.now();
    const timings: string[] = [];
    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        timings.push(`${label} ${Date.now() - t0}ms`);
      }
    };

    // Fail fast on a busy port, before anything else is opened.
    await assertPortFree(this.config.port, this.config.host);

    setLogRoot(this.config.root);
    // First middleware: one log line per request, and the request context
    // that lets handlers say where a response came from.
    this.app.use(this.requestLog.middleware);
    this.config.configureApp?.(this.app);

    // Load user config (swiss.config.ts) so internalScopes etc. flow into handlers
    const userConfig = await loadUserConfig(this.config.root);

    // CG-03: Build symlink registry before serving any requests.
    // Maps realpath(node_modules/pkg symlink) → /node_modules/pkg browser URL
    // so toUrl() can map absolute filesystem paths back to browser URLs.
    await timed("symlink-registry", async () => {
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
        const swissLib = await findSwissLibMonorepo(
          this.config.root,
          userConfig?.siblingRepositories,
        );
        if (swissLib) {
          nodeModulesDirs.push(path.join(swissLib, "node_modules"));
        }
        await buildSymlinkRegistry(nodeModulesDirs);
      } catch (err) {
        log.warn("Symlink registry build failed:", err);
      }
    });

    // Setup middleware
    const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
    const middlewareResult = await timed("middleware", () =>
      setupMiddleware(this.app, {
        root: this.config.root,
        workspaceRoot,
        publicDir: this.config.publicDir,
        resolver: this.resolver,
        hmr: this.hmr,
        userConfig,
      }),
    );
    this.routes = middlewareResult.routes;
    this.routeScanner = middlewareResult.routeScanner;
    this.routeWatcher = middlewareResult.routeWatcher;

    // Start HMR — dev-only. HMR recompiles and pushes source over an
    // unauthenticated WebSocket, which has no place in a production deployment.
    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      await timed("hmr", async () => {
        await this.hmr.initialize();
        await this.hmr.start(userConfig?.excludeFromHmr);
      });
    } else {
      log.debug("NODE_ENV=production: HMR disabled");
    }

    // Start HTTP server
    // Security (R-001): honour the requested host literally.
    // The default host is "localhost" which Node binds to the loopback
    // interface only (127.0.0.1 / ::1).  Binding all interfaces (0.0.0.0)
    // must be an explicit opt-in: the developer must set host to "0.0.0.0"
    // in their swite.config.ts or pass --host 0.0.0.0 on the CLI.
    // We never silently rewrite a requested loopback address to 0.0.0.0.
    // We also never move to another port: the URL we print must be the URL
    // that works (the internal HMR socket may move; that is reported).
    const bindHost = this.config.host;
    try {
      await timed("listen", () => this.listen(this.config.port, bindHost));
    } catch (err) {
      // Release what start() already opened so a failed start leaves nothing behind.
      await this.closeResources();
      throw err;
    }

    const address = this.httpServer?.address();
    const boundPort =
      address && typeof address === "object" ? address.port : this.config.port;
    this.startedAt = Date.now();

    const [core, compiler] = await Promise.all([
      resolveFrameworkSource(this.config.root, "@swissjs/core"),
      resolveFrameworkSource(this.config.root, "@swissjs/compiler"),
    ]);
    const pythonUrl =
      process.env["PYTHON_SERVICE_URL"] ??
      (userConfig?.services?.python
        ? `http://localhost:${userConfig.services.python.port}`
        : undefined);
    this.serverInfo = {
      ...this.serverInfo,
      port: boundPort,
      workspaceRoot,
      urls: listeningUrls(bindHost, boundPort),
      hmrPort: isProduction ? null : this.hmr.getPort(),
      core,
      compiler,
      pythonTarget: safeTarget(pythonUrl),
      readyMs: Date.now() - startTime,
    };

    log.debug(`startup timings: ${timings.join(", ")}`);
    for (const line of formatBanner(this.serverInfo)) logger.out("info", line);
  }

  private listen(port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = this.app.listen(port, host);
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new SwitePortInUseError(port, host));
        } else {
          reject(new SwiteListenError(port, host, err));
        }
      };
      server.once("error", onError);
      server.once("listening", () => {
        server.off("error", onError);
        this.httpServer = server;
        server.on("connection", (socket: Socket) => {
          this.sockets.add(socket);
          socket.once("close", () => this.sockets.delete(socket));
        });
        // After startup, later server errors are logged rather than crashing.
        server.on("error", (err) => log.error("HTTP server error:", err));
        resolve();
      });
    });
  }

  private async closeResources(): Promise<void> {
    await Promise.allSettled([
      this.hmr.stop(),
      Promise.resolve(this.routeWatcher?.close?.()),
    ]);
    this.routeWatcher = null;
  }

  /**
   * Stop accepting requests, close the HTTP server, sockets, HMR socket and
   * watchers. Idempotent. Resolves with a short run summary.
   */
  stop(): Promise<StopSummary> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      const server = this.httpServer;
      this.httpServer = null;
      const closed = server
        ? new Promise<void>((resolve) => server.close(() => resolve()))
        : Promise.resolve();
      // Idle keep-alive sockets would hold close() open: drop them now, and
      // give in-flight responses a moment before dropping the rest.
      server?.closeIdleConnections?.();
      const force = setTimeout(() => {
        for (const s of this.sockets) s.destroy();
      }, 1000);
      force.unref();
      await this.closeResources();
      await closed;
      clearTimeout(force);
      const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
      return { uptimeMs, requests: this.requestLog.count() };
    })();
    return this.stopping;
  }
}
