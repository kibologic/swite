# FRAME-002 / SW-001 Decision Memo — Federation & Plugin Architecture: Options and Recommendation

- **For:** Themba (go/no-go decision on implementation)
- **Author:** Sonnet 5, registry harness task `FRAME-002-SW-001-decision-memo`
- **Date:** 2026-07-08
- **Source findings:** `registry/fable/framework/FABLE-FRAME-002-swite-federation-not-first-class.md`,
  `registry/fable/framework/FABLE-SW-001-swite-deep-audit.md`
- **Scope of this memo:** options + design plan only. No implementation. Both source findings and
  this task's own directive are explicit that federation and the plugin architecture are the same
  underlying gap (swite has no extension point, so federation was hand-rolled into app code instead
  of becoming a swite capability) and that both findings' own sequencing note says this should land
  **before a third product build begins** — this memo is scoped with that urgency in mind, but does
  not start implementation.

---

## Executive summary

Two findings converge on one root cause. FRAME-002: module federation — the mechanism every future
Kibologic product (Alpine ERP today; Health and Hospitality next) needs to load remote module
bundles from a host app — exists only as hand-rolled, duplicated glue in `alpine-erp-core` and
`alpine-erp`'s own `server.mjs`/`federation.ui` files, not as a swite capability. SW-001: the reason
it's app glue and not a swite feature is that **swite has no plugin architecture at all** —
`SwiteUserConfig` exposes `entry`/`publicDir`/`server`/`hmr`/`excludeFromHmr`/`internalScopes`/
`siblingRepositories`/`rewrite.patterns`, but no `plugins[]` field and no `resolveId`/`load`/
`transform`/`renderChunk` lifecycle hooks. Every capability today must be hardcoded into the
960-line `build-engine/builder.ts`, which is exactly why federation had nowhere to live except app
code. This directly blocks Constitution Article 10 ("framework and build tool are extensible by
plugin, not fork"). This memo recommends building the plugin API first, then shipping federation as
the reference plugin that proves it — not the reverse, and not building a second bespoke federation
implementation ahead of the extension point it should live behind.

## Evidence

- **No plugin surface exists today** (re-verified against current code, not assumed from the
  finding): `grep -rn "plugins" src/config/config.ts` returns nothing — no `plugins[]` field.
  `SwiteUserConfig`'s actual field set is unchanged from SW-001's audit.
- **No federation module exists in swite** (re-verified): `grep -rln "federation" src/` returns
  zero files. The capability still lives entirely in `alpine-erp-core`'s and `alpine-erp`'s own
  `server.mjs`/`federation.ui`, per FRAME-002's evidence — not re-audited against those two repos
  in this pass (out of scope: this task's repo is `swite`, not the Alpine repos).
- **`builder.ts` is still 960 lines** (re-verified: `wc -l src/build-engine/builder.ts` → 960),
  unchanged since the finding, single-file esbuild wrapper with no bundler-adapter seam despite an
  `adapters/` directory existing.
- **Test coverage is still thin and unchanged**: 5 test files (`__tests__/*.test.ts`) plus 0 further
  test files under `src/` — the same "~5 test files" SW-001 measured, re-confirmed by direct count,
  not carried over as a stale claim.
- **Source maps: dev fixed, prod still off** (re-verified, and this is real progress since the
  finding's original writing): `src/dev-engine/handlers/{base,ts}-handler.ts` both now set
  `sourcemap: "inline"` (SW-001's 2026-07-03 update, recommendation 3, confirmed still present).
  `src/build-engine/builder.ts:39` still defaults `sourcemap: config.sourcemap ?? false` for
  production builds — recommendation 3 is done for dev, not done for prod; this memo's
  recommendation below scopes prod source maps as part of the plugin-host work, not a separate item.
- The `/* @vite-ignore */` artifact FRAME-002 flagged in `alpine-erp-core/apps/server/app/src/
  federation.ui:64` was already removed (finding's own 2026-07-03 update) — a symptom cleanup, not
  a structural fix; the underlying app-level glue is otherwise unchanged.

## Code locations

- `src/config/config.ts` (`SwiteUserConfig` — where a `plugins[]` field would be added)
- `src/build-engine/builder.ts` (960L; where hardcoded transforms live today; where lifecycle hooks
  would need to be threaded through)
- `src/dev-engine/` (dev-server middleware; where dev-time plugin hooks would need equivalent hook
  points)
- `src/adapters/` (existing but empty seam — the natural home for the bundler-adapter abstraction
  once a plugin host exists to put it behind)
- `__tests__/*.test.ts` (5 files; the coverage baseline any plugin-host work must not regress and
  should substantially raise)
- Out of this repo, referenced only for context: `alpine-erp-core/apps/server/server.mjs:135-158`,
  `alpine-erp-core/apps/server/app/src/federation.ui`, `alpine-erp/apps/server/server.mjs:87-102`
  (the app-level federation glue this work would eventually collapse into configuration)

## Root cause

swite grew as a purpose-built builder for SwissJS's `.ui`/`.uix` + pnpm-symlink reality, which it
serves well — the resolution engine and dependency-aware incremental cache are genuine strengths.
Extensibility was never abstracted out of that initial scope: there is no seam between "what swite's
core does" and "what a specific app or capability needs," so every new capability (federation being
the concrete, urgent example) either gets welded into `builder.ts` or pushed out into app-level glue
that must be re-derived, re-secured, and re-versioned per app. This is the same disease named
elsewhere in this registry (duplicated-not-single-sourced), applied to build-tool extensibility
specifically.

## Architectural impact

- **No reuse path for the platform's key differentiator.** Every future product (Health,
  Hospitality) must re-derive federation from app-level first principles instead of consuming a
  swite primitive — the opposite of the "repeatable engineering system" the platform is committed
  to per `fable/FABLE_ACTUALLY_FABLE_DOC.md`.
- **Duplicated security surface.** The internal-token scheme, CORS handling, and manifest parsing
  are implemented twice today (`alpine-erp-core`, `alpine-erp`) and will fragment further with each
  new product; a security fix in one app-level implementation won't reach the others.
- **No versioned manifest contract** — pairs directly with `FABLE-DRIFT-004`'s "no version
  negotiation" gap; a first-class primitive is where that contract should live once, not per-app.
- **Blocks Article 10** ("framework and build tool are extensible by plugin, not fork") — this is a
  ratified Constitution invariant swite does not yet satisfy, same category of gap as FRAME-001's
  Article 9 violation.
- **`builder.ts`'s size and single-bundler coupling** compound the risk: without a plugin seam,
  every future capability (federation included) has nowhere to go but into this file or into app
  code, growing the same problem this memo is trying to close.

## Options considered

**Option A — Plugin API first, federation as the reference plugin (both findings' own
recommendation).** Design and build a Rollup/Vite-class plugin host in swite (`plugins[]` config
field, `resolveId`/`load`/`transform`/`buildStart`/`buildEnd`/`renderChunk` hooks, plus dev-server
middleware hooks), then implement federation *as the first plugin built against that host* — proving
the API with a real, immediately-useful capability rather than a synthetic example. Manifest schema
+ version negotiation, remote-entry resolution, a swite-native dynamic-import loader (no
`@vite-ignore`), CORS/asset serving for provider mode, and a typed graceful-fallback contract all
become plugin-owned, not builder.ts-owned or app-owned. The two apps' `server.mjs`/`federation.ui`
blobs collapse into plugin configuration. This is the highest-leverage single investment named by
either finding — it closes both gaps with one piece of work instead of two, and every future
capability need (custom transforms, product-specific requirements) gets a home that isn't "fork
swite" or "write more app glue."

**Option B — Federation-specific solution now, generic plugin API later.** Build a purpose-built
federation module directly into swite core (not behind a plugin interface), solving FRAME-002 without
first solving SW-001. Faster to a working federation primitive in isolation. Rejected as the
recommendation: this repeats the exact mistake both findings describe — welding a capability into
core instead of behind an extension seam — and the plugin API would still need to be built afterward
for the *next* capability, at which point federation-in-core becomes exactly the kind of hardcoded,
hard-to-extend precedent SW-001 already flags `builder.ts` for. Also directly reintroduces the
Article 10 violation this memo is meant to close, just with a different specific capability.

**Option C — Do nothing now; keep federation as app-level glue.** Zero swite risk, zero engineering
cost today. Cost is compounding and time-boxed by the platform's own stated roadmap: both findings
are explicit this should land **before a third product build begins** (Health/Hospitality are
already in discovery phase — see `registry/docs/alpine-health/`, `registry/docs/alpine-hospitality/`).
Doing nothing means the third product re-derives federation from scratch exactly as the finding
warns, and the duplicated security surface (internal-token scheme, CORS, manifest parsing) grows
from 2 copies to 3.

**Option D — Prod source maps + bundler-adapter seam as standalone, independent tasks, decoupled
from the plugin-API decision.** Both are real, named gaps (SW-001 recommendations 3-prod and 4), but
recommendation 4 explicitly depends on the plugin host landing first (the adapter seam sits behind
it), and prod source maps is a small, low-risk, genuinely independent item that doesn't need to wait.
Listed as an option because it's the one piece of this memo's scope that *isn't* gated on the
Option A/B/C decision — see Recommendation below.

## Recommendation

**Adopt Option A (plugin API first, federation as reference plugin), sequenced behind a real test
coverage raise on the resolution engine and cache first — matching both findings' own priority
ranking, not just their preferred solution.** Reasoning:

1. Both source findings independently reach the same conclusion (FRAME-002 recommendation 1 +
   SW-001 recommendation 1/2) — this isn't a case of picking between competing recommendations, it's
   confirming neither finding's own stated preference has been overridden by anything discovered in
   this re-verification pass.
2. SW-001's own priority ranking places test coverage as **P1-worthy** (highest blast radius: swite
   "gates every production build and deploy on the platform") ahead of the plugin API's P2. This
   memo's sequencing recommendation follows that ranking literally: raise coverage on the resolution
   engine + cache (the two areas SW-001 names as swite's genuine strengths and therefore highest-
   value to protect) *before* adding a plugin host on top of them, so the plugin work has a real
   regression net rather than compounding the existing ~5-test-file gap.
3. Building federation as the reference plugin (not a synthetic "hello world" plugin) means the
   plugin API's design gets validated against a real, immediately-consumed capability, and the
   two apps' duplicated glue becomes deletable in the same effort rather than a separate follow-up.
4. Explicitly **not** recommending Option B (federation-in-core, plugin-API-later): building
   federation as a hardcoded core capability now, then having to retrofit it behind a plugin
   interface later, is strictly more work than building the interface first, and repeats the exact
   anti-pattern (`builder.ts` accretion) both findings already flag.
5. Prod source maps (part of Option D) is small, decoupled, and should not wait on the sequencing
   above — recommended as a quick, independent fix to close SW-001 recommendation 3 fully (dev is
   already done; prod is one config default change).

**Sequencing for the implementation task(s), once approved:**
1. **Quick, independent:** default `sourcemap` on for prod builds (hidden/external, not inline, to
   avoid shipping full source in production bundles) in `build-engine/builder.ts`. Small, low-risk,
   closes SW-001 recommendation 3 completely. Can happen in parallel with everything below.
2. Raise test coverage on the resolution engine and incremental-compilation cache (SW-001
   recommendation 5's first half) — the two components most worth protecting before building on top
   of them, per their own "genuine core value" / "proper dependency-aware caching" assessment.
3. Design the plugin API surface: `plugins[]` config field, `resolveId`/`load`/`transform`/
   `buildStart`/`buildEnd`/`renderChunk` hooks, dev-server middleware hook points. This is API
   design work — should itself produce a short spec (hook signatures, execution order, error
   contract) before implementation, reviewed the same way this memo is being reviewed.
4. Implement the plugin host in `build-engine/`, threading the new hooks through `builder.ts` and
   the dev-server, with tests for the host itself (not yet a capability, just the mechanism).
5. Implement federation as the first real plugin against that host: manifest schema + version
   negotiation (closing `FABLE-DRIFT-004`'s "no version negotiation" gap structurally, not just for
   swite), swite-native remote-entry dynamic import, CORS/provider-mode asset serving, typed
   graceful-fallback contract. Add the federation integration test both findings name (host boots,
   loads a provider manifest, imports a remote module, degrades cleanly when the provider is down).
6. Migrate `alpine-erp-core` and `alpine-erp` off their hand-rolled `server.mjs`/`federation.ui`
   glue onto the new plugin, collapsing two duplicated implementations into shared configuration —
   this step touches the Alpine repos and is out of this memo's scope to plan in detail (belongs to
   whoever owns that migration once the plugin exists).
7. **Only after 3-6 are proven:** the bundler-adapter seam (SW-001 recommendation 4), which
   explicitly depends on the plugin host existing to sit behind.

**What this memo is not deciding:** exact timing/priority against other in-flight platform work,
whether steps 3-4 (plugin API design + implementation) should be one task or two, and who owns step
6 (the Alpine-repo migration) once the plugin exists — those are scheduling and ownership calls for
you, not architectural ones.

## Risk assessment

- **Severity if left unaddressed:** Strategic/Medium per both findings — no live bug, but the cost
  compounds directly against the platform's stated near-term roadmap (a third product's discovery
  phase is already underway). Doing nothing here has a real, dated cost, unlike some other deferred
  findings in this registry that have no forcing function.
- **Effort:** Medium-High for the full sequence (plugin host design + implementation + federation-
  as-plugin + coverage raise) — this is genuine build-tool surgery on "the tool that gates every
  production build and deploy," the same category of caution FRAME-001's compiler-core work
  required. Low for the standalone prod-source-maps fix.
- **Risk of getting the plugin host wrong:** a poorly-designed hook contract is expensive to change
  later (every future plugin, including federation itself, depends on it) — this is exactly why
  step 3 (a written hook-signature spec, reviewed before implementation) is a named, non-optional
  part of the sequencing, not a formality.
- **Reversibility:** High for the coverage raise and source-map fix (purely additive). Medium for
  the plugin host itself — additive in principle, but a bad hook design has real switching cost
  once plugins (federation included) are written against it.

## Constitution compliance

This recommendation directly executes **Article 10** ("framework and build tool are extensible by
plugin, not fork") from `fable/FABLE_ACTUALLY_FABLE_DOC.md`'s Part XI — it closes an existing gap
between the ratified Constitution and swite's actual behavior rather than creating any new tension.
It also structurally advances closing `FABLE-DRIFT-004`'s manifest-version-negotiation gap (owning
the manifest contract once, in the plugin, rather than twice, in two apps) without itself requiring
any change to `FABLE-DRIFT-004`'s own scope. No article is put in tension by this recommendation:
the plugin host stays within `swite` (Article 3, platform core depends on nothing above it, is
unaffected), and migrating the two apps onto shared plugin configuration is a single-sourcing move
in the spirit of Article 4, not a violation of it.

## Dependencies

- Pairs with `FABLE-DRIFT-004` (atom/manifest contract single-sourcing) — federation-as-plugin is
  where that finding's "no version negotiation" gap gets structurally closed.
- No dependency on `FABLE-FRAME-001` (swiss-lib child identity) — different repo, unrelated
  mechanism, can proceed independently and in parallel.
- Step 6 (migrating `alpine-erp-core`/`alpine-erp` onto the plugin) depends on steps 3-5 completing
  first, and on those two repos' own release/branch cadence once the plugin ships.

## Implementation priority

**P2 strategic** for the plugin API + federation-as-plugin work, matching both source findings —
sequence after P0/P1 correctness and security items already in flight elsewhere in the registry, but
**before** the Health/Hospitality product builds move out of discovery phase, per both findings'
explicit timing note. **P1** for the test-coverage raise specifically (SW-001's own ranking, given
swite's blast radius). Recommended first concrete queue tasks, once you approve: `SW-001-prod-
sourcemaps` (the standalone quick fix), `SW-001-coverage-resolution-cache` (step 2), then
`FRAME-002-plugin-host-spec` (step 3, a design-review task before any implementation), followed by
`FRAME-002-plugin-host-impl` and `FRAME-002-federation-as-plugin` (steps 4-5) once the spec is
approved.
