# Claude Code — swite (SwissJS dev server & build engine)

> 🔀 **Article 20 — Assume another agent is working right now.** This monorepo is worked by multiple
> agents **concurrently and continuously**. Operate on that assumption at all times, not only when
> another agent's activity is visible.
>
> **All work happens on a feature branch cut fresh from `development`. Never commit directly to
> `development`/`staging`/`main` — not even locally. Every merge is a PR. Rebase onto current
> `development` before merge; never force-push a shared branch.**
>
> `git fetch` before you start — `development` has almost certainly moved. Check
> `git branch --show-current` before every commit. Delete your branch after merge. Push immediately
> after committing — work on one machine is invisible to every other agent.
>
> **Uncommitted changes you did not make belong to another agent.** Never stash, revert, commit, or
> force your way around them. Stop and report — a dirty tree you did not dirty is a signal, not an
> obstacle.
>
> Full doctrine: `registry/fable/FABLE-DOCTRINE-002-concurrent-agent-discipline.md`


> 🧭 **Article 18 — SwissJS evolves from its own architecture, never by imitation.** Design
> decisions originate from the SwissJS architecture and concrete Alpine requirements. **Never
> introduce an API, abstraction or capability because another framework has it. Feature parity with
> any external ecosystem is explicitly not a goal**, and resemblance to one is not evidence of
> correctness. Reason from this ecosystem's own primitives — the compiler, `.ui`/`.uix` files, the
> integrated runtime, the Alpine-first architecture. Those are the differentiator; imitation would
> discard the reason SwissJS exists. If a capability is required, we build it; if not, we don't.


**This is build infrastructure**, consumed by every product's dev server and production build.
Article 16 applies with full force: a broken build surfaces as an application symptom, so attribute
before fixing.

## ⚖️ STANDING LAW — read before diagnosing or fixing anything

**Constitution Articles 16 & 17.** Full text:
`registry/fable/FABLE-DOCTRINE-001-fix-attribution-and-test-mandate.md`
(the registry repo, `development` branch). These bind every agent in every Kibologic repo. They are
not advice and they are not optional.

### Article 16 — every fix is attributed before it is written

Establish **by evidence** which codebase owns the defect — **framework** (`swiss-lib`/`swite`) or
**application** (this repo) — and record that evidence in the task or finding, *before* writing a
fix. "It reproduces in the app" is NOT evidence of an app bug.

Attribution procedure (stop at the first step that answers it):
1. **Can you reproduce it with framework primitives alone?** If yes → framework defect. Cheapest
   and most decisive step; do this first.
2. **Does the app violate a documented framework contract?** (required `key`s, `id`+`name` on
   inputs, `scheduleUpdate()` after async state, no `return null` in `render()`, no module-level
   function declarations.) If yes → application defect — *and* file a framework finding asking why
   the framework allows it silently.
3. **Does the same symptom appear in a second, unrelated product repo?** Two products failing
   identically points at the framework or the shell, not at two apps making the same mistake.
4. **Does the mystery value exist verbatim elsewhere in the codebase?** Then it's a *leak*, not
   something generated. Grep before theorising.
5. Still unresolved → instrument the boundary: does the framework receive correct input? Yes +
   wrong output = framework. No = walk upstream into the app.

**Hard rules:**
- **Never patch a framework defect in application code.** Adding a `key`, an `id`, a defensive
  `style`, or an extra `scheduleUpdate()` to route around a framework bug is a **workaround** —
  label it as such in the code and file the framework finding in the same change. It is never
  "the fix".
- **Never modify the framework to accommodate one application's mistake.**
- **Never claim a root cause you have not reproduced.** Say "hypothesis" and label it.
- If attribution cannot be established: the verdict is **"undetermined"** — record what you ruled
  out, and write no fix.

### Article 17 — a feature without a test is a bug

Any feature, in either codebase, with no test is **defective by definition** regardless of whether
it currently works, and is logged with the same weight as a functional defect. "It works when I
click it" is not a test.

- Framework features are tested in the framework; application features in their product repo —
  **frontend included**.
- A feature spanning both needs a test on **both** sides. That pairing is what makes Article 16's
  attribution mechanical instead of speculative.

A robust test is **all four** of: (1) **use-case shaped**, not implementation shaped; (2)
**demonstrated failing before the fix** — actually revert the fix and watch it go red, a test that
passes both ways proves nothing; (3) **covers absent/null/error/transition cases**, not just the
happy path; (4) **deterministic** — a flaky test is worse than none.

**Every test is logged and cited.** "Tested" is a claim that must name something. State what you
deliberately did NOT cover.

### Before you write a line of code, answer these three

1. **Which codebase owns this?** State it, with evidence. If you can't — say "undetermined", stop.
2. **What test proves it?** In which repo? Have you watched it fail without your fix?
3. **What did I not test?** Write that down too — an honest gap beats an implied guarantee.

If the honest answer to any of these is uncomfortable, that discomfort **is** the finding. Report
it faithfully rather than routing around it.

---

## Branch — enforced, no exceptions

```
feature/* → development → staging → main
```

1. Run `git branch --show-current` first. You must be on `development` or a feature branch.
2. `git push` targets `development` only. Never push `main` or `staging` directly; promote by PR.
3. Never `git push --force` on a shared branch. Never delete `development`/`staging`/`main`.
4. Delete a feature branch (local AND remote) immediately after merge — stale branches have caused
   real work loss here before.
5. No `Co-Authored-By: Claude` in commit messages. Push immediately after every commit.

## Dependencies

A **DRR (dependency review record) is mandatory** before adding any new package, tool or service —
standing company-wide directive, no exceptions.

## Secrets

No credentials in source, Dockerfiles or scripts. Ever. Config may reference env var *names*, never
literal values.

## swite-specific rules

- Capabilities are currently hardcoded — **there is no plugin architecture yet**. Adding one is
  ratified (`FABLE-FRAME-002`/`SW-001`, Option A: plugin host first, federation as the reference
  plugin) and is the repo's next structural work. Do not accrete new capabilities directly into
  `builder.ts` (already 960 lines) — that accretion is the anti-pattern the ruling names.
- Federation glue is currently **copy-pasted into three products'** `server.mjs`. Do not add a
  fourth copy; that duplication is what the plugin host is meant to end.
- Test coverage here is thin (5 files). Per Article 17, raise coverage on the resolution engine and
  incremental cache **before** structural work, not after.
