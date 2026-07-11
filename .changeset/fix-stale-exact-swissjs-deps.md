---
"@swissjs/swite": patch
---

Fix `@swissjs/compiler`, `@swissjs/core`, and `@swissjs/plugin-file-router` being pinned to exact, stale versions (`1.2.1`, `1.2.1`, `1.2.3`) in `dependencies` instead of semver ranges. A fresh `npm install @swissjs/swite` would have resolved exactly those old versions — missing every fix shipped in either package since (including this session's reconciliation bug fix, multi-field `state{}` block fix, and `.ui` JSX-transform-gate fix in `@swissjs/core`/`@swissjs/compiler`), regardless of how recent the installed `@swissjs/swite` itself was. Changed to `^1.2.6`, `^1.2.5`, `^1.2.5` respectively (their currently-published versions).
