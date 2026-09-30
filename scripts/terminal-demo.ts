/**
 * Scripted terminal demo: launch -> running server -> closing.
 *
 *   node --import tsx scripts/terminal-demo.ts
 *   node --import tsx scripts/terminal-demo.ts --verbose
 *   NO_COLOR=1 node --import tsx scripts/terminal-demo.ts
 *
 * Boots a throwaway app on spare ports 6198 (HTTP) and 6199 (HMR), makes a few
 * requests (compiled, cache hit, 404, node_modules walk-up, proxy down,
 * proxy timeout), tries a second server on the busy port through the real
 * CLI, then sends SIGINT for a graceful stop. Never touches ports 5000/6003.
 */

import os from "node:os";
import path from "node:path";
import http from "node:http";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SwiteServer } from "../src/dev-engine/server.js";
import { proxyToPython } from "../src/adapters/proxy/proxyToPython.js";
import { sendProxyError } from "../src/adapters/proxy/gateway.js";
import { installGracefulShutdown } from "../src/dev-engine/lifecycle.js";
import { configureLoggerFromProcess, logger } from "../src/internal/logger.js";

const HTTP_PORT = 6198;
const HMR_PORT = 6199;
const CLOSED_PORT = 6197; // nothing listens here: "backend down"
const HANG_PORT = 6196; // accepts, never answers: "backend hung"

configureLoggerFromProcess(process.argv.slice(2));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeApp(): Promise<{ base: string; app: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "swite-demo-"));
  const app = path.join(base, "packages", "app");
  await fs.mkdir(path.join(app, "public"), { recursive: true });
  await fs.mkdir(path.join(app, "src"), { recursive: true });
  await fs.mkdir(path.join(base, "node_modules", "demo-lib"), { recursive: true });
  await fs.writeFile(
    path.join(app, "public", "index.html"),
    '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
  );
  await fs.writeFile(
    path.join(app, "src", "main.uix"),
    "import { SwissComponent } from '@swissjs/core'\n" +
      "export class Main extends SwissComponent {\n  render() {\n    return <div>hi</div>\n  }\n}\n",
  );
  await fs.writeFile(path.join(base, "node_modules", "demo-lib", "index.js"), "export const x = 1;\n");
  // Workspace marker, so the walk-up finds node_modules at the base.
  await fs.writeFile(path.join(base, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  // Config read by the real CLI in the second-instance step below.
  await fs.writeFile(
    path.join(app, "swiss.config.js"),
    `export default { server: { host: "0.0.0.0", port: ${HTTP_PORT}, hmrPort: ${HMR_PORT} } };\n`,
  );

  // @swissjs/core installed normally -> reported as "published".
  const core = path.join(base, "node_modules", "@swissjs", "core");
  await fs.mkdir(core, { recursive: true });
  await fs.writeFile(
    path.join(core, "package.json"),
    JSON.stringify({ name: "@swissjs/core", version: "1.2.15", main: "index.js", type: "module" }),
  );
  await fs.writeFile(path.join(core, "index.js"), "export class SwissComponent {}\n");

  // @swissjs/compiler linked to a working copy outside node_modules -> "linked".
  const linkedTarget = path.join(base, "swiss-lib", "compiler");
  await fs.mkdir(linkedTarget, { recursive: true });
  await fs.writeFile(
    path.join(linkedTarget, "package.json"),
    JSON.stringify({ name: "@swissjs/compiler", version: "1.3.0-dev" }),
  );
  await fs.symlink(linkedTarget, path.join(base, "node_modules", "@swissjs", "compiler"), "junction");
  return { base, app };
}

async function get(pathname: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}${pathname}`, { redirect: "manual" });
  await res.text();
}

function runSecondInstance(cwd: string): Promise<void> {
  return new Promise((resolve) => {
    logger.out("info", "");
    logger.out("info", "-- second instance on the busy port (real CLI) --");
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(repoRoot, "node_modules", "tsx", "dist", "esm", "index.mjs")).href,
        path.join(repoRoot, "src", "cli.ts"),
        "dev",
        ...process.argv.slice(2),
      ],
      { cwd, env: { ...process.env, PORT: String(HTTP_PORT) }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const relay = (chunk: Buffer) => process.stdout.write(chunk);
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    // Safety net: never leave a stray server behind if the port was not busy.
    const guard = setTimeout(() => child.kill(), 20_000);
    child.on("exit", (code) => {
      clearTimeout(guard);
      logger.out("info", `(second instance exit code: ${code})`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const { base, app } = await makeApp();
  const hang = http.createServer(() => {
    /* never answers */
  });
  await new Promise<void>((r) => hang.listen(HANG_PORT, "127.0.0.1", r));

  const server = new SwiteServer({
    root: app,
    port: HTTP_PORT,
    host: "0.0.0.0",
    hmrPort: HMR_PORT,
    configureApp(expressApp) {
      expressApp.get("/api/orders", async (_req, res) => {
        process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${CLOSED_PORT}`;
        try {
          res.json(await proxyToPython({ method: "GET", path: "/orders" }));
        } catch (err) {
          if (!sendProxyError(res, err)) throw err;
        }
      });
      expressApp.get("/api/report", async (_req, res) => {
        process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${HANG_PORT}`;
        try {
          res.json(await proxyToPython({ method: "GET", path: "/report", timeoutMs: 300 }));
        } catch (err) {
          if (!sendProxyError(res, err)) throw err;
        }
      });
    },
  });

  const shutdown = installGracefulShutdown({
    stop: () => server.stop(),
    cleanup: () => {
      hang.closeAllConnections();
      hang.close();
    },
    exit: (code) => logger.out("info", `(process would exit with code ${code})`),
  });

  logger.out("info", "-- launch --");
  await server.start();

  logger.out("info", "");
  logger.out("info", "-- running: requests --");
  await get("/");
  await get("/src/main.uix");
  await get("/src/main.uix");
  await get("/src/missing.js");
  await get("/node_modules/demo-lib/index.js");
  await get("/node_modules/not-installed/index.js");
  await get("/api/orders");
  await get("/api/report");

  await runSecondInstance(app);

  logger.out("info", "");
  logger.out("info", "-- closing: SIGINT --");
  process.emit("SIGINT");
  // The handler is async; wait for it to finish.
  await new Promise((r) => setTimeout(r, 1500));
  shutdown.uninstall();
  // Remove the junction itself first so the recursive delete can never follow it.
  await fs.rmdir(path.join(base, "node_modules", "@swissjs", "compiler"));
  await fs.rm(base, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
