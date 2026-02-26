import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { initPythonProxy } from "../proxy/proxyToPython.js";
import type { PythonServiceConfig } from "../config.js";

const POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 15_000;
const BACKOFF_THRESHOLD = 5;

let _child: ChildProcess | null = null;

/**
 * Spawn the Python service and wait until its health endpoint responds 200.
 * Streams stdout/stderr line-buffered, prefixed with [python].
 * Also calls initPythonProxy so proxyToPython works without PYTHON_SERVICE_URL.
 */
export async function startPythonDevService(
  config: PythonServiceConfig,
  projectRoot: string,
): Promise<void> {
  const entryPath = resolve(projectRoot, config.entry);
  const healthUrl = `http://localhost:${config.port}${config.healthCheck}`;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  console.log(
    chalk.blue(`[python] spawning: ${pythonCmd} ${config.entry} (port ${config.port})`),
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...config.env,
    PORT: String(config.port),
  };

  _child = spawn(pythonCmd, [entryPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeLines(_child.stdout, chalk.cyan("[python] "));
  pipeLines(_child.stderr, chalk.yellow("[python] "));

  _child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(
        chalk.red(
          `\n[python] process exited with code ${code} — Node server continuing in degraded mode\n`,
        ),
      );
    }
    _child = null;
  });

  initPythonProxy(config);

  await pollHealth(healthUrl);

  console.log(chalk.green(`[python] healthy — ${healthUrl}`));
}

/**
 * Send SIGTERM to the Python child process if running.
 */
export function stopPythonDevService(): void {
  if (_child) {
    console.log(chalk.gray("[python] shutting down..."));
    _child.kill("SIGTERM");
    _child = null;
  }
}

// ── internals ────────────────────────────────────────────────────────────────

function pipeLines(
  stream: NodeJS.ReadableStream | null,
  prefix: string,
): void {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) process.stdout.write(prefix + line + "\n");
    }
  });
}

async function pollHealth(url: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }

    attempt++;
    const delay =
      attempt <= BACKOFF_THRESHOLD
        ? POLL_INTERVAL_MS
        : Math.min(POLL_INTERVAL_MS * Math.pow(2, attempt - BACKOFF_THRESHOLD), 3000);

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  stopPythonDevService();
  throw new Error(
    `[python] health check timed out after ${HEALTH_TIMEOUT_MS}ms — is ${url} reachable?`,
  );
}
