/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * Process lifecycle (SWITE-008): fatal errors that log cleanly, and a
 * graceful shutdown that stops accepting requests, closes watchers and
 * sockets, prints a short summary and exits 0. A second Ctrl+C forces exit.
 */

import { logger, getLogger } from "../internal/logger.js";

const log = getLogger("process");

export type ProcessErrorKind = "unhandledRejection" | "uncaughtException";

const reported = new WeakSet<object>();

const HEADLINE: Record<ProcessErrorKind, string> = {
  unhandledRejection: "Unhandled promise rejection",
  uncaughtException: "Uncaught exception",
};

/**
 * Log one grouped error for a process-level failure. The same error object
 * is never reported twice. The stack is printed only at debug level.
 */
export function reportProcessError(kind: ProcessErrorKind, reason: unknown): void {
  if (typeof reason === "object" && reason !== null) {
    if (reported.has(reason)) return;
    reported.add(reason);
  }
  const err = reason instanceof Error ? reason : new Error(String(reason));
  if (log.isEnabled("debug")) {
    log.error(`${HEADLINE[kind]}:`, err);
  } else {
    log.error(`${HEADLINE[kind]}: ${err.message} (run with --verbose for the stack)`);
  }
}

export interface ProcessErrorOptions {
  /** Exit with code 1 after logging. Defaults to NODE_ENV === "production". */
  exitOnError?: boolean;
  exit?: (code: number) => void;
}

/**
 * Install unhandledRejection / uncaughtException handlers. Returns a function
 * that removes them. Not installed by SwiteServer itself: a host app decides.
 * The CLI installs them.
 */
export function installProcessErrorHandlers(options: ProcessErrorOptions = {}): () => void {
  const exitOnError = options.exitOnError ?? process.env["NODE_ENV"] === "production";
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const handle = (kind: ProcessErrorKind) => (reason: unknown) => {
    reportProcessError(kind, reason);
    if (exitOnError) {
      process.exitCode = 1;
      setImmediate(() => exit(1));
    }
  };
  const onRejection = handle("unhandledRejection");
  const onException = handle("uncaughtException");
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  };
}

export interface StopSummary {
  uptimeMs: number;
  requests: number;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.floor(s % 60)).padStart(2, "0")}s`;
}

export function formatStopSummary(summary: StopSummary): string {
  const n = summary.requests;
  return `Stopped after ${formatDuration(summary.uptimeMs)}, ${n} request${n === 1 ? "" : "s"}`;
}

export interface GracefulShutdownOptions {
  /** Close the server, watchers and sockets; resolve with the run summary. */
  stop: () => Promise<StopSummary>;
  /** Extra synchronous cleanup, e.g. killing the Python child. */
  cleanup?: () => void;
  exit?: (code: number) => void;
  /** Force exit if graceful stop takes longer than this. Default 5000 ms. */
  forceAfterMs?: number;
  signals?: NodeJS.Signals[];
}

export interface GracefulShutdown {
  /** Begin shutdown as if `reason` was received. A second call forces exit. */
  shutdown(reason: string): Promise<void>;
  uninstall(): void;
}

export function installGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const forceAfterMs = options.forceAfterMs ?? 5000;
  const signals: NodeJS.Signals[] =
    options.signals ??
    (process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"]);
  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      logger.out("warn", "Second interrupt: forcing exit without waiting.");
      exit(1);
      return;
    }
    shuttingDown = true;
    logger.out("info", `Shutting down (${reason}). Press Ctrl+C again to force.`);
    const timer = setTimeout(() => {
      logger.out("warn", `Graceful stop took longer than ${forceAfterMs}ms: forcing exit.`);
      exit(1);
    }, forceAfterMs);
    timer.unref();
    try {
      const summary = await options.stop();
      options.cleanup?.();
      clearTimeout(timer);
      logger.out("info", formatStopSummary(summary));
      exit(0);
    } catch (err) {
      clearTimeout(timer);
      options.cleanup?.();
      log.error("Shutdown failed:", err);
      exit(1);
    }
  };

  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const sig of signals) {
    const handler = () => void shutdown(sig);
    handlers.set(sig, handler);
    process.on(sig, handler);
  }

  return {
    shutdown,
    uninstall() {
      for (const [sig, handler] of handlers) process.off(sig, handler);
    },
  };
}
