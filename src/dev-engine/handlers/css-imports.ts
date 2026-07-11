/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

/**
 * Rewrite CSS imports in already-compiled JS output into something a
 * browser-executed ES module can actually run -- a raw `import` of a
 * `.css` file is not valid JS, and the compiler/esbuild transform passes
 * upstream of this don't touch import specifiers by extension.
 *
 * - Named/default imports (CSS modules): replace with a const binding to an
 *   empty object, so `import styles from "./x.module.css"` gets `{}`
 *   instead of `undefined`.
 * - Side-effect imports (`import "./x.css"`): stripped silently -- no
 *   runtime value needed.
 * - Dynamic imports (`import("./x.css")`): replaced with `({})`.
 *
 * Shared by every handler that serves compiled JS to the browser (.ui/.uix
 * via base-handler, plus .ts/.js/.mjs) so a plain .ts/.js file importing
 * CSS doesn't silently 404/parse-error in the browser while .ui/.uix files
 * work -- previously only base-handler.ts had this, and the other three
 * handlers had no CSS handling at all.
 */
export function rewriteCssImports(compiled: string): string {
  let result = compiled;
  // Named/default imports → const <binding> = {}
  result = result.replace(
    /^[^\S\r\n]*import\s+((?:\w+\s*,?\s*)?(?:\{[^}]*\}\s*,?\s*)?(?:\*\s+as\s+\w+\s*)?)\bfrom\s*['"][^'"]*\.css['"]\s*;?[^\S\r\n]*$/gm,
    (_match, binding) => {
      const ids: string[] = [];
      const defaultMatch = binding.match(/^(\w+)(?:\s*,|\s*$)/);
      if (defaultMatch) ids.push(defaultMatch[1]);
      const nsMatch = binding.match(/\*\s+as\s+(\w+)/);
      if (nsMatch) ids.push(nsMatch[1]);
      const namedMatch = binding.match(/\{([^}]+)\}/);
      if (namedMatch) {
        namedMatch[1].split(",").forEach((s: string) => {
          const alias = s.trim().split(/\s+as\s+/).pop()?.trim();
          if (alias) ids.push(alias);
        });
      }
      return ids.length ? ids.map((id) => `const ${id} = {};`).join(" ") : "";
    },
  );
  // Side-effect imports → strip
  result = result.replace(/^[^\S\r\n]*import\s*['"][^'"]*\.css['"]\s*;?[^\S\r\n]*$/gm, "");
  // Dynamic imports → empty object
  result = result.replace(/\bimport\s*\(\s*['"][^'"]*\.css['"]\s*\)/g, "({})");
  return result;
}
