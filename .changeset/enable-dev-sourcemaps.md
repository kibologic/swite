---
"@swissjs/swite": patch
---

Fix: dev server now emits inline source maps for both the plain `.ts` esbuild
transform path and the post-`UiCompiler` `.ui`/`.uix` transform path. Dev
builds previously shipped zero source maps, so devtools couldn't map
compiled output back to source.
