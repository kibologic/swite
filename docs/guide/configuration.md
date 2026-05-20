<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Configuration

SWITE reads `swiss.config.ts` (or `swiss.config.js`) from the project root. The file must export a `SwiteUserConfig` object as its default export, typically via the `defineConfig` helper.

```typescript
// swiss.config.ts
import { defineConfig } from '@swissjs/swite';

export default defineConfig({
  server: {
    port: 3000,
    host: 'localhost',
  },
  services: {
    python: {
      entry: 'server/main.py',
      port: 8000,
      autoStart: true,
      healthCheck: '/health',
    },
  },
});
```

The config file is transpiled to ESM by esbuild at startup (bundling disabled, `platform: node`). The temporary output file is cleaned up before the server starts.

---

## SwiteUserConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `server` | `ServerConfig` | `{}` | HTTP server options |
| `services` | `ServicesConfig` | `{}` | External service options |

---

## ServerConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | Port for the HTTP server |
| `host` | `string` | `"localhost"` | Host to bind. When `"localhost"`, SWITE binds to `0.0.0.0` internally so both IPv4 and IPv6 loopback addresses work |

---

## ServicesConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `python` | `PythonServiceConfig` | — | Python service definition. Omit if you have no Python backend |

---

## PythonServiceConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entry` | `string` | Yes | Path to the Python entry file, relative to the project root (e.g. `"server/main.py"`) |
| `port` | `number` | Yes | Port the Python service listens on |
| `autoStart` | `boolean` | Yes | When `true`, `swite dev` spawns the Python process automatically before starting the Node server |
| `healthCheck` | `string` | Yes | URL path polled to determine when the Python service is ready (e.g. `"/health"`). SWITE polls `http://localhost:{port}{healthCheck}` every 500 ms, with exponential back-off after five attempts, timing out after 15 seconds |
| `env` | `Record<string, string>` | No | Additional environment variables merged into the Python process environment alongside `PORT={port}` |

---

## defineConfig

`defineConfig(config: SwiteUserConfig): SwiteUserConfig` is a pass-through identity function that provides TypeScript type checking at the call site. Unknown fields are rejected at compile time.

---

## Environment variables

In addition to `swiss.config.ts`, SWITE reads `.env` files at the project root for `import.meta.env` inlining. Variables are inlined at compile time into each compiled module; they are not available at runtime via a global object. SWITE loads both a base `.env` and a mode-specific `.env.development` or `.env.production` depending on whether the server is running in dev or production mode.

The following environment variables affect SWITE's own runtime behavior:

| Variable | Description |
|----------|-------------|
| `PYTHON_SERVICE_URL` | Base URL of the Python service in production. Required when running `swite start` with a Python service configured. Overrides the localhost fallback used in dev. |
| `INTERNAL_API_TOKEN` | Value injected as the `X-Internal-Token` header on every `proxyToPython` call |
| `SWITE_CDN_FALLBACK_SCOPES` | Comma-separated list of scoped package prefixes (e.g. `@types,@tanstack`) that are allowed to fall back to jsDelivr when not found locally. Unscoped packages always fall back. Scoped packages do not fall back by default. |
