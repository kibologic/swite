---
"@swissjs/swite": patch
---

Bump the declared `esbuild` dependency range from `^0.25.0` to `^0.28.1` to match the `pnpm.overrides.esbuild: ">=0.28.1"` floor already in this package.json, added in a prior security-hardening commit (`dc966c5`, "resolve CVEs"). The declared range never got updated to match — a consumer installing `@swissjs/swite` without inheriting this workspace's pnpm overrides (a different package manager, or pnpm without root-level override propagation) would resolve the vulnerable `^0.25.0` range instead of the intended, already-tested `0.28.1+`.
