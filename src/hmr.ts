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
    return `
// SWITE HMR Client
console.log('[SWITE] HMR enabled');

const socket = new WebSocket('ws://localhost:${this.port}');
const moduleGraph = new Map<string, Set<string>>();
const hotModules = new Map<string, any>();

socket.addEventListener('open', () => {
  console.log('[SWITE] HMR connected');
});

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'update') {
    console.log('[SWITE] Processing update:', data.path, 'Type:', data.updateType);
    
    if (data.updateType === 'style') {
      // Hot swap CSS
      updateStyles();
      console.log('[SWITE] Styles hot updated');
    } else if (data.updateType === 'hot') {
      // Hot reload component
      const moduleName = extractModuleName(data.path);
      
      if (moduleName && hotModules.has(moduleName)) {
        const oldModule = hotModules.get(moduleName);
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
      // Full reload for everything else
      console.log('[SWITE] Full page reload required');
      window.location.reload();
    }
  }
});

function updateStyles() {
  // Find all style and link tags
  const styles = document.querySelectorAll('link[rel="stylesheet"], style');
  styles.forEach(style => {
    if (style.tagName === 'LINK' && style.getAttribute('href')) {
      const href = style.getAttribute('href');
      if (href && !href.includes('?t=')) {
        // Add timestamp to force reload
        style.setAttribute('href', href + '?t=' + Date.now());
      }
    }
  });
}

function extractModuleName(path: string): string | null {
  // Extract module name from file path
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  
  if (fileName) {
    const nameWithoutExt = fileName.replace(/.[^.]+$/, "");
    return nameWithoutExt;
  }
  
  return null;
}

function invalidateModule(moduleName: string) {
  // Clear module from cache
  if (typeof window !== 'undefined' && (window as any).__swiss_modules__) {
    delete (window as any).__swiss_modules__[moduleName];
  }
}

function invalidateDependents(moduleName: string) {
  const dependents = moduleGraph.get(moduleName);
  if (dependents) {
    for (const dependent of dependents) {
      invalidateModule(dependent);
    }
  }
}

function updateComponent(moduleName: string, newModule: any) {
  // Find and update component instances
  if (typeof window !== 'undefined' && (window as any).__swiss_instances__) {
    const instances = (window as any).__swiss_instances__[moduleName];
    if (instances && Array.isArray(instances)) {
      instances.forEach(instance => {
        // Update component state if it has update method
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

// Register module for hot reloading
if (typeof window !== 'undefined') {
  (window as any).__swiss_modules__ = (window as any).__swiss_modules__ || {};
  (window as any).__swiss_instances__ = (window as any).__swiss_instances__ || {};
  
  // Auto-register current module
  const currentScript = document.currentScript;
  if (currentScript && currentScript.src) {
    const moduleName = extractModuleName(currentScript.src);
    if (moduleName) {
      (window as any).__swiss_modules__[moduleName] = true;
    }
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
