<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Contributing

---

## Build

SWITE is compiled from TypeScript to `dist/` using the TypeScript compiler:

```bash
pnpm build          # single build
pnpm dev            # watch mode (tsc -b --watch)
```

The `bin.swite` field in `package.json` points to `dist/cli.js`. After a build, the CLI is runnable as `node dist/cli.js dev` from the package root, or via the `swite` binary when the package is installed.

To clean build artifacts and `node_modules`:

```bash
pnpm clean
```

---

## Running tests

```bash
pnpm test
```

Tests run via Node's built-in test runner (`node --import tsx --test`). Test files live in `__tests__/`. Add new test files with a `.test.ts` extension.

---

## Generating an import map

The import map generation CLI is separate from the main build:

```bash
pnpm generate-import-map
```

This runs `src/internal/generate-import-map-cli.ts` via `tsx` and writes `.swite/import-map.json` in the current directory. Run this from the project root of an application, not from the SWITE package root.

---

## Changesets and releases

SWITE uses `@changesets/cli` for versioning.

```bash
pnpm changeset              # create a changeset for your changes
pnpm release:version        # bump versions from pending changesets
pnpm release:publish        # publish to npm
```

---

## Branch conventions

- Work in feature branches named `feat/<topic>` or `fix/<topic>`.
- Do not push directly to the default branch.
- Each PR should include a changeset unless the change is documentation-only.

---

## Package scope

SWITE is published as `@swissjs/swite`. The npm registry is `registry.npmjs.org` with `access: public`. The repository is part of the `kibologic/alpine-erp-core` GitHub repo.
