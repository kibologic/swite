/**
 * Centralised /swiss-lib/ → /swiss-packages/ path fixup.
 *
 * Root cause: the UiCompiler emits absolute `/swiss-lib/` paths in some code
 * paths (compiler was written against an older directory structure). Until the
 * compiler is fixed at source this single function is the authoritative fixup.
 * Apply it once per compilation, before passing code to the import rewriter.
 *
 * All seven previous fixup locations across ui-handler, uix-handler, and
 * import-rewriter have been removed in favour of this call.
 */
export function fixSwissLibPaths(code: string): string {
  if (!code.includes('/swiss-lib/')) return code;
  // More-specific pattern first so `/swiss-lib/packages/` doesn't leave a
  // dangling `/swiss-packages/packages/` if the replacement ran twice.
  return code
    .replace(/\/swiss-lib\/packages\//g, '/swiss-packages/')
    .replace(/\/swiss-lib\//g, '/swiss-packages/');
}
