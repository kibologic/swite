/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * Gateway helper (SWITE-008): turn a proxyToPython failure into a clear HTTP
 * answer. "Backend down" is a first-class failure of this platform (Node is
 * the gateway, Python owns the domain), so it gets first-class wording:
 * 502 when the service is unreachable, 504 when it does not answer in time.
 */

import type { Response } from "express";
import {
  SwiteProxyError,
  SwiteProxyTimeoutError,
  SwiteProxyUnreachableError,
} from "./SwiteProxyError.js";
import { markSource } from "../../dev-engine/request-context.js";

export interface GatewayErrorBody {
  error: string;
  target: string | null;
  hint: string;
}

export interface GatewayFailure {
  status: number;
  body: GatewayErrorBody;
  /** Short reason appended to the request log line. */
  note: string;
}

/** Map a thrown proxy error to a status and JSON body. Returns null for other errors. */
export function describeProxyFailure(err: unknown): GatewayFailure | null {
  if (err instanceof SwiteProxyUnreachableError) {
    return {
      status: 502,
      note: `python unreachable at ${err.target}`,
      body: {
        error: err.message,
        target: err.target,
        hint: "Start the Python service or check PYTHON_SERVICE_URL / services.python.port.",
      },
    };
  }
  if (err instanceof SwiteProxyTimeoutError) {
    return {
      status: 504,
      note: `python timeout after ${err.timeoutMs}ms at ${err.target}`,
      body: {
        error: err.message,
        target: err.target,
        hint: "The Python service is slow or hung. Raise SWITE_PROXY_TIMEOUT_MS or services.python.timeoutMs if the work is expected to take long.",
      },
    };
  }
  if (err instanceof SwiteProxyError) {
    return {
      status: err.status >= 500 ? 502 : err.status,
      note: `python answered ${err.status}`,
      body: {
        error: err.message,
        target: null,
        hint: "The Python service answered with an error; see its own log.",
      },
    };
  }
  return null;
}

/**
 * Answer `res` for a failed proxy call. Returns true when the error was a
 * proxy failure and a response was sent; false means the caller should handle it.
 */
export function sendProxyError(res: Response, err: unknown): boolean {
  const failure = describeProxyFailure(err);
  if (!failure) return false;
  markSource("proxy", res);
  res.locals["switeNote"] = failure.note;
  if (!res.headersSent) res.status(failure.status).json(failure.body);
  return true;
}
