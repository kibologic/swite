/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * One line per request (SWITE-003):
 *   <METHOD> <path> <status> <ms>ms <source> [slow]
 *
 * Never logs bodies, headers, cookies, tokens or query strings. The path is a
 * URL path, never a filesystem path.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import chalk from "chalk";
import { logger, type LogLevel } from "../../internal/logger.js";
import { getSource, runInRequest, type ResponseSource } from "../request-context.js";

export interface RequestLogOptions {
  /** Requests slower than this are tagged "slow". Default 500 ms. */
  slowMs?: number;
}

export interface RequestLog {
  middleware: RequestHandler;
  /** Number of requests answered since creation. */
  count(): number;
}

const DEFAULT_SLOW_MS = 500;
const MAX_PATH = 200;

/** Internal paths that are logged at debug, not info. */
const INTERNAL_PREFIXES = ["/__swite", "/.skltn/", "/favicon.ico"];

const DRIVE_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/][^\s?#]*/g;

/** Reduce an original URL to a safe path: no query, no hash, no fs paths. */
export function safeRequestPath(originalUrl: string): string {
  const noQuery = originalUrl.split(/[?#]/, 1)[0] || "/";
  let p = noQuery.replace(DRIVE_PATH, "<path>");
  if (p.length > MAX_PATH) p = p.slice(0, MAX_PATH - 3) + "...";
  return p;
}

export function levelForStatus(
  status: number,
  internal: boolean,
  source?: ResponseSource,
): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  // A CDN redirect means the module was NOT found locally: worth a warning.
  if (source === "cdn-redirect") return "warn";
  return internal ? "debug" : "info";
}

function inferSource(res: Response, status: number): ResponseSource {
  const explicit = getSource(res);
  if (explicit) return explicit;
  if (status >= 500) return "error";
  if (status >= 300 && status < 400) {
    const location = res.getHeader("location");
    if (typeof location === "string" && /^https?:\/\//i.test(location)) {
      return "cdn-redirect";
    }
  }
  return "static";
}

function paintStatus(status: number, text: string): string {
  if (status >= 500) return chalk.red(text);
  if (status >= 400) return chalk.yellow(text);
  if (status >= 300) return chalk.cyan(text);
  return chalk.green(text);
}

export function formatRequestLine(fields: {
  method: string;
  path: string;
  status: number;
  ms: number;
  source: ResponseSource;
  slow: boolean;
  note?: string;
}): string {
  const { method, path, status, ms, source, slow, note } = fields;
  const duration = `${ms}ms`.padStart(7);
  const line =
    `${method.padEnd(6)} ${path.padEnd(40)} ` +
    `${paintStatus(status, String(status))} ${duration}  ${source}` +
    (slow ? "  slow" : "") +
    (note ? `  - ${note}` : "");
  return line;
}

export function createRequestLog(options: RequestLogOptions = {}): RequestLog {
  const slowMs = options.slowMs ?? DEFAULT_SLOW_MS;
  let total = 0;

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    const path = safeRequestPath(req.originalUrl || req.url);
    const method = req.method;

    res.on("finish", () => {
      total++;
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const status = res.statusCode;
      const internal = INTERNAL_PREFIXES.some((p) => path.startsWith(p));
      const source = inferSource(res, status);
      const level = levelForStatus(status, internal, source);
      if (!logger.isEnabled(level)) return;
      logger.out(
        level,
        formatRequestLine({
          method,
          path,
          status,
          ms,
          source,
          slow: ms >= slowMs,
          note: typeof res.locals["switeNote"] === "string" ? res.locals["switeNote"] : undefined,
        }),
      );
    });

    res.on("close", () => {
      if (res.writableFinished) return;
      total++;
      logger.out("debug", `${method.padEnd(6)} ${path} aborted by client`);
    });

    runInRequest(res, next);
  };

  return { middleware, count: () => total };
}
