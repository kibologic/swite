<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# CLI

SWITE is invoked as `swite <command>`. There are three commands:

- [swite dev](./dev.md) — Start the development server with HMR and optional Python autostart
- [swite build](./build.md) — Build the application for production using esbuild
- [swite start](./start.md) — Start the development server in production mode (no HMR, no Python autostart)

All three commands read `swiss.config.ts` (or `swiss.config.js`) from the current working directory before doing anything else. The current working directory is the project root; SWITE does not accept a path argument.
