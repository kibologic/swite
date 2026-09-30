#!/usr/bin/env node
import { resolve } from "node:path";
import { SwiteServer } from "./dev-engine/server.js";
import { loadUserConfig } from "./config/config-loader.js";
import {
  startPythonDevService,
  stopPythonDevService,
} from "./dev-engine/pythonDevManager.js";
import { setProductionMode } from "./adapters/proxy/proxyToPython.js";
import {
  configureLoggerFromProcess,
  getLogger,
  setLogRoot,
} from "./internal/logger.js";
import {
  installGracefulShutdown,
  installProcessErrorHandlers,
} from "./dev-engine/lifecycle.js";
import { SwiteListenError, SwitePortInUseError } from "./dev-engine/listen-errors.js";

const [, , command, ...args] = process.argv;
const root = resolve(process.cwd());

// Logger first, so everything after it obeys --verbose / --quiet / --no-color.
//   --verbose, -v   debug output (SWITE_DEBUG=1 is an alias)
//   --quiet, -q     warnings and errors only
//   --no-color      plain text (NO_COLOR / FORCE_COLOR are also honoured)
//   --timestamps    prefix lines with a time (automatic when output is piped)
configureLoggerFromProcess(args);
setLogRoot(root);

const log = getLogger("swite");

// Unhandled rejections / uncaught exceptions: one grouped error line, and a
// nonzero exit in production.
installProcessErrorHandlers();

/** Port precedence: swite config, then PORT, then 3000. */
function resolvePort(configPort: number | undefined): number {
  if (configPort !== undefined) return configPort;
  const fromEnv = Number(process.env["PORT"]);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3000;
}

/** Print a fatal error the way an operator wants to read it, then exit 1. */
function fatal(err: unknown): never {
  if (err instanceof SwitePortInUseError || err instanceof SwiteListenError) {
    // Message is already complete and actionable: no stack, no raw object.
    log.error(err.message);
  } else {
    log.error("fatal:", err);
  }
  stopPythonDevService();
  process.exit(1);
}

async function serve(mode: "dev" | "start"): Promise<void> {
  const config = await loadUserConfig(root);
  const python = config.services?.python;

  if (mode === "dev") {
    if (python?.autoStart) {
      await startPythonDevService(python, root);
    }
  } else {
    setProductionMode();
    if (python && !process.env["PYTHON_SERVICE_URL"]) {
      log.warn(
        "services.python is configured but PYTHON_SERVICE_URL is not set. " +
          "Proxy calls to Python will fail. Set PYTHON_SERVICE_URL to the running service URL.",
      );
    }
  }

  const server = new SwiteServer({
    root,
    port: resolvePort(config.server?.port),
    host: config.server?.host ?? "localhost",
    hmrPort: config.server?.hmrPort,
    publicDir: config.publicDir ?? "public",
    open: false,
  });

  // Ctrl+C / SIGTERM: stop accepting, close watchers and sockets, stop the
  // Python child, print a summary, exit 0. A second Ctrl+C forces exit.
  installGracefulShutdown({
    stop: () => server.stop(),
    cleanup: stopPythonDevService,
  });

  // Ensure Python is killed if Node exits for any other reason
  process.on("exit", () => {
    stopPythonDevService();
  });

  await server.start();
}

async function build(): Promise<void> {
  const { SwiteBuilder } = await import("./build-engine/builder.js");
  const builder = new SwiteBuilder({
    root,
    entry: resolve(root, "src/index.ui"),
    outDir: resolve(root, "dist"),
  });
  await builder.build();
}

switch (command) {
  case "dev":
    serve("dev").catch(fatal);
    break;

  case "start":
    serve("start").catch(fatal);
    break;

  case "build":
    build().catch((err: unknown) => {
      log.error("build failed:", err);
      process.exit(1);
    });
    break;

  default:
    log.error(`unknown command: ${command ?? "(none)"}`);
    log.error("Usage: swite <dev|build|start> [--verbose|-v] [--quiet|-q] [--no-color]");
    process.exit(1);
}
