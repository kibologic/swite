/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * Per-request context (SWITE-003). Lets any code running inside a request -
 * a handler, the resolver, proxyToPython - say where the response came from
 * without threading `res` through every call. Built on node:async_hooks, no
 * dependency. The request log reads the value on response finish.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Response } from "express";
import { getLogger } from "../internal/logger.js";

export type ResponseSource =
  | "compiled"
  | "cache"
  | "node_modules"
  | "static"
  | "spa"
  | "cdn-redirect"
  | "proxy"
  | "error";

interface RequestStore {
  res: Response;
}

const storage = new AsyncLocalStorage<RequestStore>();

/** Run `fn` with `res` as the current request. Used by the request log. */
export function runInRequest<T>(res: Response, fn: () => T): T {
  return storage.run({ res }, fn);
}

/**
 * Record where the response for the current request came from.
 * Stored on `res.locals.switeSource`. The first specific value wins over a
 * later "static"/"error" but a handler may always overwrite with `force`.
 */
export function markSource(source: ResponseSource, res?: Response): void {
  const target = res ?? storage.getStore()?.res;
  if (!target) return;
  target.locals["switeSource"] = source;
}

export function getSource(res: Response): ResponseSource | undefined {
  return res.locals["switeSource"] as ResponseSource | undefined;
}

const MAX_NOTE = 160;

/**
 * Attach a one-line reason to the current request's log line. Used for
 * failures so the operator sees "500 ... - <reason>" on one line; the stack
 * is available at debug level only.
 */
export function noteRequestError(res: Response, error: unknown, label: string): void {
  if ((error as { code?: string } | null)?.code === "ENOENT") {
    // A missing file is a 404, not a server fault: no stack, no error source.
    res.locals["switeNote"] = `${label}: file not found`;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  const short = firstLine.length > MAX_NOTE ? firstLine.slice(0, MAX_NOTE - 3) + "..." : firstLine;
  res.locals["switeNote"] = `${label}: ${short}`;
  markSource("error", res);
  getLogger("request").debug(
    `${label} failed`,
    error instanceof Error ? error : new Error(message),
  );
}
