<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Import Rewriting

The browser cannot fetch bare module specifiers like `@swissjs/core` or `react`. SWITE rewrites every bare import in compiled source to an absolute browser URL before serving.

---

## How it works

`rewriteImports` (`src/resolution/rewriting/import-rewriter.ts`) is called by every file handler after compilation. It uses `es-module-lexer` to find all imports in the code, then applies a collect-and-replace strategy:

1. Parse the code with `es-module-lexer` to get the position of every import specifier.
2. For each specifier, determine the quoted span in the original string (including the surrounding quote characters).
3. Collect each replacement as `{ start, end, text }` in original-string coordinates.
4. Sort replacements by descending start position.
5. Apply replacements right-to-left, so that each substitution does not shift the positions of specifiers to its left.

This approach eliminates the offset-tracking errors that arise when applying replacements left-to-right.

---

## What is rewritten

Only bare module specifiers (those not starting with `.` or `/`) are passed to `ModuleResolver.resolve`. Relative and absolute path imports are left unchanged.

CSS imports are skipped entirely — they are not ES modules.

---

## Variable references are not rewritten

SWITE only rewrites **string literal** specifiers. Variable references in dynamic imports are left unchanged.

```javascript
// This WILL be rewritten — string literal
const mod = await import('@swissjs/router');

// This will NOT be rewritten — variable reference
const mod = await import(def.componentUrl);
```

`es-module-lexer` identifies only string literals in import positions. Variable references do not appear as import specifiers in the lexer output.

`ModuleResolver.resolve` also guards against variable-like specifiers: a specifier containing `.` but not starting with `@` (e.g. `def.componentUrl`) is returned unchanged with a warning log rather than being resolved as a module path.

### Required pattern for runtime-determined paths

When the import target is a runtime value, assign it to a simple local variable first:

```typescript
// Correct
const url = def.componentUrl;
const mod = await import(url);

// Avoid — property access may pass the lexer differently across compiler versions
const mod = await import(def.componentUrl);
```

---

## Extension fixup

The `@swissjs/compiler` occasionally emits `.js` or `.tsx` extensions in relative import paths for files that exist on disk as `.ui` or `.uix`. Before collecting replacements, `rewriteImports` checks each relative import ending in `.js` or `.tsx`: if the corresponding `.ui` or `.uix` file exists on disk, the extension is corrected.

The correction depends on the importer context:

- If the importer is a file in `swiss-packages/` or `lib/`, the extension is rewritten to `.ts`.
- If the importer is a `.ui` or `.uix` file, the extension is rewritten to `.ui` or `.uix` based on which file exists on disk.
- Otherwise `.ts`.

A regex fallback pass applies the same logic for any `.js`/`.tsx` relative imports the lexer may have missed.

---

## Safety net

After the primary lexer pass, `rewriteImports` scans the result with a regex for any remaining bare scoped imports (`@scope/pkg/…`). If any are found, they are rewritten using the CDN fallback or `/node_modules/` URL. This catches cases where the lexer silently failed to parse a particular import form.

---

## Debugging bare imports

If compiled output still contains bare imports after rewriting, SWITE logs:

```
[SWITE] import-rewriter: CRITICAL — bare import "@scope/pkg" still present after rewriting
```

Each handler also checks its final output and logs any remaining bare imports:

```
[.ui] Bare imports still present after rewriting: /src/MyComponent.ui
[.ui] Unresolved import: @scope/pkg
```

The `/__swite_diagnose?url=<path>` endpoint fetches any URL the server serves and reports whether bare imports are present in the response, along with the first ten import specifiers found.
