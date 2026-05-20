<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Architecture

Internal design of SWITE.

- [Dev server](./dev-server.md) — SwiteServer, workspace root detection, middleware chain, file handlers
- [Import resolution](./resolution.md) — ModuleResolver, bare-import resolution, workspace packages, CDN fallback, import map
- [Import rewriting](./import-rewriting.md) — how module specifiers in compiled output are rewritten to browser URLs
- [Build pipeline](./build-pipeline.md) — SwiteBuilder, esbuild integration, `.ui`/`.uix` compilation
- [HMR](./hmr.md) — WebSocket server, chokidar watcher, client injection, file-change-to-reload flow
- [Python integration](./python-integration.md) — Python service lifecycle, health polling, proxy adapter, production mode
