import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { initPythonProxy } from "../adapters/proxy/proxyToPython.js";
import type { PythonServiceConfig } from "../config/config.js";
import { getLogger, logger } from "../internal/logger.js";

const log = getLogger("python");

const POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 30_000;
const BACKOFF_THRESHOLD = 5;

let _child: ChildProcess | null = null;
/** True while we are the ones stopping the child, so its exit is not reported as a crash. */
let _stopping = false;
/** The last few output lines of the child, shown once if it exits with an error. */
const RECENT_LIMIT = 10;
const _recent: string[] = [];

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

  log.debug(
    `spawning: ${pythonCmd} ${config.entry} (port ${config.port})`,
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

  _stopping = false;
  _recent.length = 0;
  pipeLines(_child.stdout, "[python] ");
  pipeLines(_child.stderr, "[python] ");

  _child.on("exit", (code) => {
    if (code !== null && code !== 0 && !_stopping) {
      // Reported once, with the child's last output, instead of a bare code.
      const tail = _recent.length ? `\n  last output:\n    ${_recent.join("\n    ")}` : "";
      log.error(
        `Python service exited with code ${code}; Node server continuing in degraded mode${tail}`,
      );
    }
    _child = null;
  });

  initPythonProxy(config);

  await pollHealth(healthUrl);

  log.info(`Python service healthy at ${healthUrl}`);
}

/**
 * Send SIGTERM to the Python child process if running.
 */
export function stopPythonDevService(): void {
  if (_child) {
    log.debug("stopping Python service");
    _stopping = true;
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
      if (!line.trim()) continue;
      _recent.push(line);
      if (_recent.length > RECENT_LIMIT) _recent.shift();
      logger.out("info", prefix + line);
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
    `Python health check timed out after ${HEALTH_TIMEOUT_MS}ms: is ${url} reachable?`,
  );
}
