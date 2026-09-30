---
"@swissjs/swite": minor
---

Terminal UI for the whole lifecycle: launch, running server, closing (SWITE-002, 003, 004, 007, 008).

- One internal logger with levels (`error`, `warn`, `info`, `debug`, `trace`). The default level is `info`: the launch banner, one line per request, warnings and errors. `--verbose` / `-v` (or `SWITE_DEBUG=1`) selects `debug`, `--quiet` / `-q` selects `warn`, `SWITE_LOG_LEVEL` sets any level. Colour follows the TTY, `NO_COLOR`, `FORCE_COLOR` and `--no-color`. Levels and statuses are always text (`WARN`, `ERROR`, `404`); no emoji is written.
- One log line per request: `<METHOD> <path> <status> <ms>ms <source>` where source is `compiled`, `cache`, `node_modules`, `static`, `spa`, `cdn-redirect`, `proxy` or `error`. Slow requests (default 500 ms, `slowRequestMs` / `SWITE_SLOW_MS`) are tagged. Cookies, tokens, request bodies and query strings are never logged.
- Expected probe misses (pnpm walk-up, `.ts`/`.js` fallbacks) and startup chatter moved to debug. The stale `VERSION 0.3.5` strings are gone.
- Launch banner (at most 8 lines) with the real URLs (including a `Network` line for `0.0.0.0`), version, mode, HMR port and where `@swissjs/core` and `@swissjs/compiler` resolved from (`published <version>` or `linked <path>`). The same data is returned by the new `SwiteServer.info()`.
- Port already in use: `start()` rejects with `SwitePortInUseError`, the CLI prints one line and exits 1. `proxyToPython` now throws `SwiteProxyUnreachableError` / `SwiteProxyTimeoutError` (timeout via `timeoutMs`, `SWITE_PROXY_TIMEOUT_MS` or `services.python.timeoutMs`, default 10 s) and the new `sendProxyError()` helper answers 502 / 504 JSON with `target` and `hint`. Graceful shutdown on SIGINT / SIGTERM prints a short summary; a second Ctrl+C forces exit. New `SwiteServer.stop()`, `installProcessErrorHandlers()` and `installGracefulShutdown()` for host apps.

Behaviour changes to note: a missing `.js` / `.mjs` / `.ui` file now answers 404 (it was 500); the CLI honours `PORT` when no `server.port` is configured; the default console output is much quieter, so anything that relied on scraping the old per-request lines should use `--verbose`.
