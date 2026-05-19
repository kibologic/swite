/*
 * HMR Engine for SWITE
 */

import * as chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import * as net from "net";
import chalk from "chalk";

export class HMREngine {
  private wss!: WebSocketServer;
  private watcher?: chokidar.FSWatcher;
  private clients = new Set<WebSocket>();
  private port: number;

  constructor(
    private root: string,
    hmrPort?: number,
  ) {
    this.port = hmrPort || 24678;
    // WebSocketServer will be created in initialize() method
    // This allows async port checking before server creation
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
    this.wss.on("connection", (ws) => {
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

  async start() {
    this.watcher = chokidar.watch(this.root, {
      ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
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
    // NOTE: This string is served as plain JavaScript to the browser.
    // No TypeScript syntax (generics, type annotations, `as` casts) is allowed here.
    return `
// SWITE HMR Client
console.log('[SWITE] HMR enabled');

const socket = new WebSocket('ws://' + window.location.hostname + ':${this.port}');
const moduleGraph = new Map();
const hotModules = new Map();

socket.addEventListener('open', () => {
  console.log('[SWITE] HMR connected');
});

socket.addEventListener('message', async (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'update') {
    console.log('[SWITE] Processing update:', data.path, 'Type:', data.updateType);

    if (data.updateType === 'style') {
      updateStyles();
      console.log('[SWITE] Styles hot updated');
    } else if (data.updateType === 'hot') {
      const moduleName = extractModuleName(data.path);

      if (moduleName && hotModules.has(moduleName)) {
        try {
          invalidateModule(moduleName);
          invalidateDependents(moduleName);

          const updatedModule = await import(data.path + '?t=' + Date.now());
          hotModules.set(moduleName, updatedModule);

          updateComponent(moduleName, updatedModule);
          console.log('[SWITE] Component hot updated:', moduleName);
        } catch (error) {
          console.error('[SWITE] Hot update failed:', error);
          window.location.reload();
        }
      } else {
        console.log('[SWITE] New component detected, reloading page');
        window.location.reload();
      }
    } else {
      console.log('[SWITE] Full page reload required');
      window.location.reload();
    }
  }
});

function updateStyles() {
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      // Strip existing ?t= query before adding a fresh timestamp so repeated
      // style updates always trigger a new network request.
      const base = href.replace(/[?&]t=\\d+/, '');
      link.setAttribute('href', base + (base.includes('?') ? '&' : '?') + 't=' + Date.now());
    }
  });
}

function extractModuleName(filePath) {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  return fileName ? fileName.replace(/\\.[^.]+$/, '') : null;
}

function invalidateModule(moduleName) {
  if (window.__swiss_modules__) {
    delete window.__swiss_modules__[moduleName];
  }
}

function invalidateDependents(moduleName) {
  const dependents = moduleGraph.get(moduleName);
  if (dependents) {
    for (const dependent of dependents) {
      invalidateModule(dependent);
    }
  }
}

function updateComponent(moduleName, newModule) {
  if (window.__swiss_instances__) {
    const instances = window.__swiss_instances__[moduleName];
    if (instances && Array.isArray(instances)) {
      instances.forEach(instance => {
        if (instance && typeof instance.update === 'function') {
          instance.update(newModule.default || newModule);
        }
      });
    }
  }
}

socket.addEventListener('close', () => {
  console.log('[SWITE] HMR disconnected');
});

socket.addEventListener('error', (error) => {
  console.error('[SWITE] HMR error:', error);
});

window.__swiss_modules__ = window.__swiss_modules__ || {};
window.__swiss_instances__ = window.__swiss_instances__ || {};

const currentScript = document.currentScript;
if (currentScript && currentScript.src) {
  const moduleName = extractModuleName(currentScript.src);
  if (moduleName) {
    window.__swiss_modules__[moduleName] = true;
  }
}
`;
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
    timestamp: number;
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
