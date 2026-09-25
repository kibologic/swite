---
"@swissjs/swite": patch
---

Exempt the document root from the SPA fallback's `Accept` header gate (SWITE-001, #40). The
fallback middleware's `Accept`-header check previously applied to every unmatched request path
including `/`, which could make the dev server's document root fail to fall back to `index.html`
under the same conditions as any other SPA route.

Commit: ca3c6b0.
