<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Python Integration

SWITE supports a co-located Python backend service. The integration has two parts: lifecycle management during development and a proxy adapter used by application code to forward requests.

---

## Dev lifecycle

`startPythonDevService(config, projectRoot)` (`src/dev-engine/pythonDevManager.ts`) is called by `swite dev` when `services.python.autoStart` is `true`.

### Process spawning

```
python3 {config.entry}     (python on Windows)
```

The process is spawned with:
- `stdio: ['ignore', 'pipe', 'pipe']` — stdin is closed; stdout and stderr are piped
- Environment: current process environment merged with `config.env`, plus `PORT={config.port}`

Stdout and stderr are read line-buffered and printed to Node's stdout with `[python]` prefixes.

### Health polling

After spawning, `pollHealth(url)` polls `http://localhost:{port}{config.healthCheck}` every 500 ms. The request uses a 1-second `AbortSignal` timeout per attempt. When the response is `ok`, polling stops and the Node server proceeds.

After five attempts the poll interval grows exponentially (doubling with each attempt) up to a maximum of 3 seconds per attempt. The total deadline is 15 seconds. If the deadline passes, SWITE calls `stopPythonDevService()` and throws.

### Shutdown

`stopPythonDevService()` sends `SIGTERM` to the child process. It is registered on both `SIGINT` (Ctrl-C) and the Node `exit` event so the Python process is always cleaned up.

---

## initPythonProxy

`initPythonProxy(config)` stores the `PythonServiceConfig` in module-level state. It is called immediately after `startPythonDevService` resolves, so `proxyToPython` can derive the base URL from the config's port before `PYTHON_SERVICE_URL` is set.

---

## proxyToPython

`proxyToPython<T>(options)` (`src/adapters/proxy/proxyToPython.ts`) is the adapter application code uses to forward requests to the Python service.

### Base URL resolution

| Condition | Base URL |
|-----------|----------|
| `PYTHON_SERVICE_URL` env var is set | `PYTHON_SERVICE_URL` (trailing slash stripped) |
| Not set, dev mode, config initialized | `http://localhost:{config.port}` |
| Not set, production mode | throws immediately |

### Request

Every call injects the `X-Internal-Token` header with the value of `INTERNAL_API_TOKEN` (empty string if not set). When `options.body` is provided, `Content-Type: application/json` is added and the body is serialized with `JSON.stringify`.

Non-2xx responses throw `SwiteProxyError` with the HTTP status, a description, and the parsed response body.

### Options

```typescript
interface ProxyOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;       // e.g. '/api/orders'
  body?: unknown;     // JSON-serializable
  headers?: Record<string, string>;
}
```

---

## Production mode

`setProductionMode()` is called by `swite start` before the server starts. In production mode:

- The localhost fallback is disabled. If `PYTHON_SERVICE_URL` is not set, `proxyToPython` throws `"PYTHON_SERVICE_URL is required in production mode but is not set."` rather than attempting a localhost connection.
- The Python process is never spawned. The `services.python` config is read only to emit the startup warning if `PYTHON_SERVICE_URL` is absent.

---

## Environment variable summary

| Variable | Used by | Description |
|----------|---------|-------------|
| `PYTHON_SERVICE_URL` | `proxyToPython` | Base URL of the Python service. Required in production. Overrides localhost fallback in dev. |
| `INTERNAL_API_TOKEN` | `proxyToPython` | Value of the `X-Internal-Token` header on every proxy request |
| `PORT` | Python process | Set automatically to `config.port` by SWITE when spawning the Python process |
