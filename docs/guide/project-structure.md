<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Project Structure

Conventions for a SWITE-powered application.

---

## Application layout

```
my-app/
├── src/
│   ├── index.ui              # entry point — referenced by public/index.html
│   ├── App.ui                # root component
│   ├── components/           # reusable UI components
│   └── types/                # shared TypeScript types
├── public/
│   └── index.html            # HTML shell — SWITE injects import map and CSS links
├── .swite/
│   └── import-map.json       # generated at build time; optional at dev time
├── dist/                     # production build output (gitignored)
├── package.json
└── swiss.config.ts           # optional config
```

---

## Source file conventions

| Extension | Handler | Description |
|-----------|---------|-------------|
| `.ui`     | UIHandler | SwissJS component syntax; compiled by `@swissjs/compiler` then TypeScript-stripped by esbuild |
| `.uix`    | UIXHandler | JSX variant of SwissJS component syntax; same pipeline as `.ui` |
| `.ts`     | TSHandler | Plain TypeScript; TypeScript-stripped by esbuild only |
| `.js`     | JSHandler | Plain JavaScript; import-rewritten but not compiled |
| `.mjs`    | MJSHandler | Same as `.js`; falls back to `.js` if `.mjs` does not exist |

SWITE handles extension negotiation: a request for `/src/Foo.js` will be served from `Foo.ts`, `Foo.ui`, or `Foo.uix` if the `.js` file does not exist on disk. Similarly, a request for `/src/Foo.ts` falls back to `.ui` or `.uix`.

---

## public/ directory

The `public/` directory is served as static files. SWITE's SPA fallback reads `public/index.html` and:

- Injects cache-busting query parameters on the entry point `<script>` tag
- Injects an `<script type="importmap">` block from `.swite/import-map.json` (merging with any existing importmap in HTML)
- Injects `<link rel="stylesheet">` tags for CSS files discovered in the entry point source

Files under `public/` are served with `no-cache` headers during development.

---

## Config file

SWITE looks for `swiss.config.ts` (preferred) or `swiss.config.js` at the project root. Both are optional. If neither exists, SWITE starts with defaults: port 3000, host `localhost`, no Python service.

See [Configuration](./configuration.md) for the full field reference.

---

## Workspace layout

When SWITE detects a monorepo (by walking up the directory tree looking for `pnpm-workspace.yaml` or a `package.json` with `workspaces`), it:

- Scans workspace `node_modules` for package resolution
- Serves `lib/`, `libraries/`, and `modules/` directories as static file prefixes
- Compiles source files under `packages/` through the handler pipeline

The workspace root is detected automatically; it can also be set explicitly via `SwiteConfig.rootDir`.
