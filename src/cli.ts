#!/usr/bin/env node
import { resolve } from "node:path";
import chalk from "chalk";
import { SwiteServer } from "./server.js";
import { loadUserConfig } from "./config-loader.js";
import {
  startPythonDevService,
  stopPythonDevService,
} from "./dev/pythonDevManager.js";
import { setProductionMode } from "./proxy/proxyToPython.js";

const [, , command, ...args] = process.argv;
const root = resolve(process.cwd());

async function dev(): Promise<void> {
  const config = await loadUserConfig(root);
  const python = config.services?.python;

  if (python?.autoStart) {
    await startPythonDevService(python, root);
  }

  // Relay SIGINT: kill Python, then exit cleanly
  process.on("SIGINT", () => {
    stopPythonDevService();
    process.exit(0);
  });

  // Ensure Python is killed if Node crashes
  process.on("exit", () => {
    stopPythonDevService();
  });

  const server = new SwiteServer({
    root,
    port: config.server?.port ?? 3000,
    host: config.server?.host ?? "localhost",
    publicDir: "public",
    open: false,
  });

  await server.start();
}

async function start(): Promise<void> {
  const config = await loadUserConfig(root);
  const python = config.services?.python;

  setProductionMode();

  if (python && !process.env["PYTHON_SERVICE_URL"]) {
    console.warn(
      chalk.yellow(
        "[swite] WARNING: services.python is configured but PYTHON_SERVICE_URL is not set.\n" +
          "        Proxy calls to Python will fail. Set PYTHON_SERVICE_URL to the running service URL.",
      ),
    );
  }

  const server = new SwiteServer({
    root,
    port: config.server?.port ?? 3000,
    host: config.server?.host ?? "localhost",
    publicDir: "public",
    open: false,
  });

  await server.start();
}

async function build(): Promise<void> {
  const { SwiteBuilder } = await import("./builder.js");
  const config = await loadUserConfig(root);
  const builder = new SwiteBuilder({
    root,
    entry: resolve(root, "src/index.ts"),
    outDir: resolve(root, "dist"),
  });
  await builder.build();
}

switch (command) {
  case "dev":
    dev().catch((err: unknown) => {
      console.error(chalk.red("[swite] fatal:"), err);
      stopPythonDevService();
      process.exit(1);
    });
    break;

  case "start":
    start().catch((err: unknown) => {
      console.error(chalk.red("[swite] fatal:"), err);
      process.exit(1);
    });
    break;

  case "build":
    build().catch((err: unknown) => {
      console.error(chalk.red("[swite] build failed:"), err);
      process.exit(1);
    });
    break;

  default:
    console.error(chalk.red(`[swite] unknown command: ${command ?? "(none)"}`));
    console.error("Usage: swite <dev|build|start>");
    process.exit(1);
}
