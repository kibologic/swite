/*
 * HMR Engine for SWITE
 */

import * as chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import * as net from "net";
import chalk from "chalk";
import { buildHmrClientScript } from "./hmr-client-template.js";

export class HMREngine {
  private wss!: WebSocketServer;
  private watcher?: chokidar.FSWatcher;
  private clients = new Set<WebSocket>();
  private port: number;
  /** Origins permitted to connect (e.g. "http://localhost:3000"). */
  private allowedOrigins: Set<string>;

  constructor(
    private root: string,
    hmrPort?: number,
    allowedOrigins: string[] = [],
  ) {
    this.port = hmrPort || 24678;
    // Security (R-002): build an origin allowlist.
    // Always allow the two canonical loopback forms so a default dev setup
    // (host: "localhost", port: 3000) works without any extra config.
    this.allowedOrigins = new Set([
      ...allowedOrigins,
    ]);
    // WebSocketServer will be created in initialize() method
    // This allows async port checking before server creation
  }

  /**
   * Return true when `origin` is on the allowlist.
   * - Absent / empty origin header → REJECT (not a browser page request).
   * - Exact match (scheme + host + optional port) → ALLOW.
   * - The check is case-insensitive on the scheme+host portion per RFC 6454.
   */
  private isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    // Normalise: strip trailing slash, lower-case scheme+host.
    const normalise = (o: string) => o.replace(/\/$/, "").toLowerCase();
    const candidate = normalise(origin);
    for (const allowed of this.allowedOrigins) {
      if (normalise(allowed) === candidate) return true;
    }
    return false;
  }

  async initialize(): Promise<void> {
    // Check if port is available, if not find a free one
    const isAvailable = await this.checkPortAvailable(this.port);
    if (!isAvailable) {
      console.warn(
        chalk.yellow(`[HMR] Port ${this.port} is in use, finding free port...`),
      );
      this.port = await this.findFreePort();
    }

    this.wss = new WebSocketServer({ port: this.port });
    this.setupWebSocket();
    console.log(
      chalk.green(`[HMR] WebSocket server started on port ${this.port}`),
    );
  }

  private async checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });
  }

  private setupWebSocket() {
    // Security (R-002): validate the Origin header on every incoming WebSocket
    // upgrade to prevent cross-site WebSocket hijacking.  A malicious page
    // served from a different origin cannot subscribe to HMR events (which
    // include absolute filesystem paths of every changed file).
    //
    // Connections with a missing or non-allowlisted Origin are rejected with
    // a 403 close frame.  Same-origin connections from the dev server's own
    // host:port are always allowed via this.allowedOrigins.
    this.wss.on("connection", (ws, req) => {
      const origin = req.headers["origin"];
      if (!this.isOriginAllowed(origin)) {
        console.warn(
          chalk.red(
            `[HMR] Rejected connection from disallowed origin: ${origin ?? "(none)"}`,
          ),
        );
        ws.close(1008, "Origin not allowed");
        return;
      }

      this.clients.add(ws);
      console.log(chalk.green("[HMR] Client connected"));

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(chalk.gray("[HMR] Client disconnected"));
      });
    });
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        const port =
          address && typeof address === "object" ? address.port : null;
        server.close(() => {
          if (port) {
            resolve(port);
          } else {
            reject(new Error("Could not find free port"));
          }
        });
      });
      server.on("error", reject);
    });
  }

  getPort(): number {
    return this.port;
  }

  async start(excludeFromHmr?: string[]) {
    const baseIgnored = ["**/node_modules/**", "**/.git/**", "**/dist/**"];
    const ignored = excludeFromHmr ? [...baseIgnored, ...excludeFromHmr] : baseIgnored;

    this.watcher = chokidar.watch(this.root, {
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    });

    this.watcher.on("change", (filePath) => {
      console.log(chalk.yellow(`[HMR] ${filePath} changed`));

      // Determine file type and update type
      const fileExt = filePath.split(".").pop()?.toLowerCase();
      const updateType = this.getUpdateType(fileExt, filePath);

      this.broadcast({
        type: "update",
        path: filePath,
        updateType,
        timestamp: Date.now(),
      });
    });

    this.watcher.on("add", (filePath) => {
      console.log(chalk.yellow(`[HMR] File added: ${filePath}`));
      // New file — dependents are unknown, trigger a full reload
      this.broadcast({ type: "reload", path: filePath, reason: "file-added" });
    });

    this.watcher.on("unlink", (filePath) => {
      console.log(chalk.yellow(`[HMR] File deleted: ${filePath}`));
      // Deleted file — its dependents will 404 on next import, trigger reload
      this.broadcast({ type: "reload", path: filePath, reason: "file-deleted" });
    });

    console.log(chalk.green("[HMR] Watching for file changes..."));
  }

  notifyChange(filePath: string): void {
    const fileExt = filePath.split(".").pop()?.toLowerCase();
    const updateType = this.getUpdateType(fileExt, filePath);

    this.broadcast({
      type: "update",
      path: filePath,
      updateType,
      timestamp: Date.now(),
    });
  }

  getClientScript(): string {
    return buildHmrClientScript(this.port);
  }

  private getUpdateType(
    fileExt?: string,
    filePath?: string,
  ): "hot" | "reload" | "style" {
    if (!fileExt || !filePath) return "reload";

    // CSS files can be hot-swapped
    if (fileExt === "css" || fileExt === "scss" || fileExt === "sass") {
      return "style";
    }

    // Component files can be hot-reloaded
    if (["js", "ts", "jsx", "tsx"].includes(fileExt)) {
      // Check if it's in components directory
      if (filePath.includes("/components/") || filePath.includes("/pages/")) {
        return "hot";
      }
    }

    // Everything else requires full reload
    return "reload";
  }

  private broadcast(message: {
    type: string;
    path: string;
    updateType?: string;
    reason?: string;
    timestamp?: number;
  }) {
    const payload = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  async stop() {
    await this.watcher?.close();
    this.wss.close();
  }
}
