# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

`.changeset/config.json` is already present and `package.json` already wires `pnpm changeset` /
`pnpm release:version` / `pnpm release:publish` against `@changesets/cli` (^2.29.5, already a
devDependency). What's missing in practice is discipline: SWITE-001 (#40, merged to `development`
2026-08-18 -- exempt document root from SPA fallback's Accept-header gate) shipped with no
changeset, so `package.json` still reads `0.4.7` (matching the last published/tagged release,
`v0.4.7`) despite a real unreleased fix on `development`.

Add a changeset (`pnpm changeset`) alongside any user-facing fix or feature before merging. Do not
bump `package.json`'s version by hand -- `changeset version` does that at release time, from a
publish session on the operator's other machine (this repo's rule: no local manual publish, ever).
