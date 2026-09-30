/**
 * Shared helpers for the terminal-UI tests (SWITE-002/003/004/007/008):
 * a throwaway app, free ports, and a log capture.
 */

import os from "node:os";
import path from "node:path";
import net from "node:net";
import { promises as fs } from "node:fs";
import { configureLogger, getLoggerOptions, type LogLevel } from "../../src/internal/logger.js";

export interface TestApp {
  /** Workspace base (holds pnpm-workspace.yaml and a shared node_modules). */
  base: string;
  /** App root: <base>/packages/app */
  app: string;
  cleanup(): Promise<void>;
}

const BASIC_UIX =
  "import { SwissComponent } from '@swissjs/core'\n" +
  "export class Main extends SwissComponent {\n  render() {\n    return <div>hi</div>\n  }\n}\n";

/**
 * Build a small app:
 *   <base>/node_modules/demo-lib/index.js         (found 3 probes up from the app)
 *   <base>/node_modules/@swissjs/core/            (a normal, "published" install)
 *   <base>/packages/app/public/index.html
 *   <base>/packages/app/src/main.uix              (valid)
 *   <base>/packages/app/src/broken.uix            (does not compile)
 */
export async function makeTestApp(): Promise<TestApp> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "swite-term-"));
  const app = path.join(base, "packages", "app");
  await fs.mkdir(path.join(app, "public"), { recursive: true });
  await fs.mkdir(path.join(app, "src"), { recursive: true });
  await fs.mkdir(path.join(base, "node_modules", "demo-lib"), { recursive: true });
  await fs.writeFile(path.join(base, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await fs.writeFile(
    path.join(app, "public", "index.html"),
    '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
  );
  await fs.writeFile(path.join(app, "src", "main.uix"), BASIC_UIX);
  await fs.writeFile(path.join(app, "src", "broken.uix"), "export class {{{ not valid <<<\n");
  await fs.writeFile(path.join(base, "node_modules", "demo-lib", "index.js"), "export const x = 1;\n");
  const core = path.join(base, "node_modules", "@swissjs", "core");
  await fs.mkdir(core, { recursive: true });
  await fs.writeFile(
    path.join(core, "package.json"),
    JSON.stringify({ name: "@swissjs/core", version: "1.2.15", main: "index.js", type: "module" }),
  );
  await fs.writeFile(path.join(core, "index.js"), "export class SwissComponent {}\n");
  return {
    base,
    app,
    async cleanup() {
      // Remove any junction we created first, so the recursive delete cannot follow it.
      try {
        await fs.rmdir(path.join(base, "node_modules", "@swissjs", "compiler"));
      } catch {
        /* none created */
      }
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

/** Ask the OS for a free TCP port (bound on all interfaces, then released). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, () => {
      const addr = s.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export interface LogCapture {
  lines: string[];
  /** Restore the previous logger configuration. */
  restore(): void;
}

/** Capture logger output with colour and timestamps off. */
export function captureLogs(level: LogLevel = "info"): LogCapture {
  const previous = { ...getLoggerOptions() };
  const lines: string[] = [];
  configureLogger({
    level,
    color: false,
    timestamps: false,
    sink: { write: (_stream, line) => lines.push(line) },
  });
  // The log root is set by SwiteServer.start(); restoring must not undo it.
  const { level: l, color, timestamps, sink } = previous;
  return { lines, restore: () => configureLogger({ level: l, color, timestamps, sink }) };
}

export async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(url, { redirect: "manual", ...init });
  return { status: res.status, body: await res.text(), headers: res.headers };
}
