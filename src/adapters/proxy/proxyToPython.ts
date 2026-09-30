import type { PythonServiceConfig } from "../../config/config.js";
import {
  SwiteProxyError,
  SwiteProxyTimeoutError,
  SwiteProxyUnreachableError,
} from "./SwiteProxyError.js";
import { markSource } from "../../dev-engine/request-context.js";

/** Default time to wait for the Python service before answering 504. */
export const DEFAULT_PROXY_TIMEOUT_MS = 10_000;

let _pythonConfig: PythonServiceConfig | null = null;
let _productionMode = false;

/**
 * Called by swite start on startup.
 * Disables localhost fallback — PYTHON_SERVICE_URL is the only valid base URL.
 */
export function setProductionMode(): void {
  _productionMode = true;
}

/**
 * Called by the swite dev process manager (S-03) on startup.
 * Stores the resolved python service config for use by proxyToPython.
 */
export function initPythonProxy(config: PythonServiceConfig): void {
  _pythonConfig = config;
}

export interface ProxyOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Abort and throw SwiteProxyTimeoutError after this many milliseconds.
   * Precedence: this option, SWITE_PROXY_TIMEOUT_MS, services.python.timeoutMs,
   * then DEFAULT_PROXY_TIMEOUT_MS.
   */
  timeoutMs?: number;
}

function resolveTimeoutMs(explicit?: number): number {
  if (explicit !== undefined && explicit > 0) return explicit;
  const fromEnv = Number(process.env["SWITE_PROXY_TIMEOUT_MS"]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromConfig = _pythonConfig?.timeoutMs;
  if (fromConfig !== undefined && fromConfig > 0) return fromConfig;
  return DEFAULT_PROXY_TIMEOUT_MS;
}

function causeCode(err: unknown): string | null {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

/**
 * Proxy a request from the Node server to the internal Python service.
 *
 * Resolves base URL from PYTHON_SERVICE_URL env var if set,
 * otherwise falls back to http://localhost:{python.port} from config.
 *
 * Always injects X-Internal-Token header.
 * Throws SwiteProxyError on non-2xx responses, SwiteProxyUnreachableError when
 * the service cannot be reached and SwiteProxyTimeoutError when it does not
 * answer in time. Marks the current request's log line as source "proxy".
 */
export async function proxyToPython<T>(options: ProxyOptions): Promise<T> {
  const envBaseUrl = process.env["PYTHON_SERVICE_URL"];

  let baseUrl: string;
  if (envBaseUrl) {
    baseUrl = envBaseUrl.replace(/\/$/, "");
  } else if (!_productionMode && _pythonConfig) {
    baseUrl = `http://localhost:${_pythonConfig.port}`;
  } else {
    throw new Error(
      _productionMode
        ? "PYTHON_SERVICE_URL is required in production mode but is not set."
        : "Python service not configured. Call initPythonProxy() before using proxyToPython, or set PYTHON_SERVICE_URL.",
    );
  }

  const token = process.env["INTERNAL_API_TOKEN"] ?? "";
  const url = `${baseUrl}${options.path}`;

  const requestHeaders: Record<string, string> = {
    "X-Internal-Token": token,
    ...options.headers,
  };

  if (options.body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  markSource("proxy");
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  // Never put the query string in messages: it can carry secrets.
  const safePath = options.path.split("?", 1)[0];

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: requestHeaders,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SwiteProxyTimeoutError(baseUrl, options.method, safePath, timeoutMs);
    }
    throw new SwiteProxyUnreachableError(baseUrl, options.method, safePath, causeCode(err));
  }

  try {
    if (!response.ok) {
      const text = await response.text();
      let responseBody: unknown = text;
      try {
        responseBody = JSON.parse(text);
      } catch {
        /* not JSON: keep the text */
      }
      throw new SwiteProxyError(
        response.status,
        `Python service responded with ${response.status} on ${options.method} ${safePath}`,
        responseBody,
      );
    }
    return (await response.json()) as T;
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SwiteProxyTimeoutError(baseUrl, options.method, safePath, timeoutMs);
    }
    throw err;
  }
}
