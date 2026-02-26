import type { PythonServiceConfig } from "../config.js";
import { SwiteProxyError } from "./SwiteProxyError.js";

let _pythonConfig: PythonServiceConfig | null = null;

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
}

/**
 * Proxy a request from the Node server to the internal Python service.
 *
 * Resolves base URL from PYTHON_SERVICE_URL env var if set,
 * otherwise falls back to http://localhost:{python.port} from config.
 *
 * Always injects X-Internal-Token header.
 * Throws SwiteProxyError on non-2xx responses.
 */
export async function proxyToPython<T>(options: ProxyOptions): Promise<T> {
  const envBaseUrl = process.env["PYTHON_SERVICE_URL"];

  let baseUrl: string;
  if (envBaseUrl) {
    baseUrl = envBaseUrl.replace(/\/$/, "");
  } else if (_pythonConfig) {
    baseUrl = `http://localhost:${_pythonConfig.port}`;
  } else {
    throw new Error(
      "Python service not configured. Call initPythonProxy() before using proxyToPython, or set PYTHON_SERVICE_URL.",
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

  const response = await fetch(url, {
    method: options.method,
    headers: requestHeaders,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text();
    }
    throw new SwiteProxyError(
      response.status,
      `Python service responded with ${response.status} on ${options.method} ${options.path}`,
      responseBody,
    );
  }

  return response.json() as Promise<T>;
}
