<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# HMR

`HMREngine` (`src/dev-engine/hmr/hmr.ts`) manages the WebSocket server and file watcher that power hot module replacement.

---

## WebSocket server

The WebSocket server is created by the `ws` package. The default port is 24678. On initialization, SWITE checks whether that port is available by attempting to bind a temporary TCP server. If the port is occupied, `findFreePort()` asks the OS for an available port by binding to port 0 and reading the assigned port back.

All connected browser clients are tracked in a `Set<WebSocket>`. When a client disconnects, it is removed from the set.

The HMR client script is served at `/__swite_hmr_client` as plain JavaScript. The actual WebSocket port is embedded into this script at server startup so the browser client connects to the correct port even when it differs from 24678.

---

## File watcher

`HMREngine.start()` creates a chokidar watcher on the project root with these options:

- Ignored: `node_modules/`, `.git/`, `dist/`
- `ignoreInitial: true` — no events are fired for files that exist at startup
- `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 }` — waits for the file to stop changing before firing, which prevents partial-write events

On each `change` event, SWITE determines the update type from the file extension and broadcasts a message to all connected clients.

---

## Update type classification

| File extension | Update type | Browser action |
|---------------|-------------|----------------|
| `.css`, `.scss`, `.sass` | `style` | Cache-busts `href` on all `<link rel="stylesheet">` elements by appending `?t={timestamp}` |
| `.js`, `.ts` in `components/` or `pages/` | `hot` | Re-imports the module and calls `instance.update(newModule)` on registered component instances |
| Everything else | `reload` | `window.location.reload()` |

---

## Broadcast message format

```json
{
  "type": "update",
  "path": "/absolute/path/to/changed/file",
  "updateType": "hot | reload | style",
  "timestamp": 1716211234567
}
```

Messages are sent only to clients whose `readyState` is `WebSocket.OPEN`. Clients in any other state are skipped.

---

## HMR client

`buildHmrClientScript(port)` (`src/dev-engine/hmr/hmr-client-template.ts`) returns the browser-side JavaScript as a string with the port number substituted at runtime.

The client:

1. Opens a WebSocket connection to `ws://{hostname}:{port}`.
2. On `message`, dispatches to `updateStyles()`, the hot-update path, or `window.location.reload()`.
3. Maintains a `moduleGraph` map (module name → dependents) and a `hotModules` map (module name → module object) for the hot path.
4. On hot update: removes the module from `window.__swiss_modules__`, re-imports it with a cache-busting `?t={timestamp}` suffix, and calls `instance.update(newModule)` on each registered instance in `window.__swiss_instances__`.
5. If the hot update throws, falls back to `window.location.reload()`.

`window.__swiss_modules__` and `window.__swiss_instances__` are initialized to empty objects if not already present. The SwissJS runtime populates `__swiss_instances__` with component instance arrays keyed by component name.

---

## notifyChange

`HMREngine.notifyChange(filePath)` is a programmatic interface for triggering HMR broadcasts without a file system event. It is available for use by other server-side logic (such as the file router) that needs to signal a module change.
