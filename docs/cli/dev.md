<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# swite dev

Starts the SWITE development server.

```bash
swite dev
```

---

## What it does

1. Loads `swiss.config.ts` from the project root via esbuild transpilation.
2. If `services.python.autoStart` is `true` in the config, spawns the Python process at `python3 {entry}` (or `python` on Windows), passes `PORT={port}` plus any `env` fields, and polls the health endpoint until it responds 200 or the 15-second timeout is reached.
3. Registers `SIGINT` and `process.exit` handlers to send `SIGTERM` to the Python process when Node shuts down.
4. Starts `SwiteServer` on the configured port and host, then begins the HMR WebSocket server on port 24678 (or the next available port).

---

## Python autostart

When `autoStart: true` is set, the Python process is started before the Node HTTP server. SWITE streams Python stdout prefixed with `[python]` (cyan) and stderr prefixed with `[python]` (yellow). If the health check times out, SWITE kills the Python process and exits with an error.

```typescript
// swiss.config.ts
export default defineConfig({
  services: {
    python: {
      entry: 'server/main.py',
      port: 8000,
      autoStart: true,
      healthCheck: '/health',
      env: { ENVIRONMENT: 'development' },
    },
  },
});
```

---

## HMR

The HMR WebSocket server starts on port 24678. If that port is occupied, SWITE probes the OS for the next free port. The actual port is embedded into the HMR client script served at `/__swite_hmr_client`.

Every `.ui`, `.uix`, `.ts`, and `.js` file under the project root is watched by chokidar (excluding `node_modules/`, `.git/`, and `dist/`). When a file changes, SWITE broadcasts a JSON message to all connected WebSocket clients:

```json
{ "type": "update", "path": "/abs/path/to/file", "updateType": "hot|reload|style", "timestamp": 1234567890 }
```

Update type classification:

| Update type | Condition |
|-------------|-----------|
| `style`     | `.css`, `.scss`, or `.sass` file |
| `hot`       | `.js` or `.ts` file under `components/` or `pages/` |
| `reload`    | everything else |

The browser client handles `style` by cache-busting stylesheet `href` attributes. It handles `hot` by re-importing the module and calling `instance.update()` on registered instances. Everything else triggers `window.location.reload()`.

---

## Development headers

All compiled source files are served with aggressive no-cache headers:

```
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
```

This prevents browsers from serving stale compiled output between reloads.

---

## Diagnostic endpoints

| Endpoint | Description |
|----------|-------------|
| `/__swite_hmr_client` | HMR client JavaScript (injected by index.html) |
| `/__swite_routes` | JSON array of route definitions from the file router |
| `/__swite_diagnose?url=<path>` | Fetches the given path and reports bare imports found in the response |
| `/__swite_clear_cache` | HTML page that clears browser caches and service workers, then redirects to `/` |
