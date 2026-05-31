/**
 * Centralised /swiss-lib/ → /swiss-packages/ path fixup.
 *
 * Root cause: the UiCompiler emits absolute `/swiss-lib/` paths in some code
 * paths (compiler was written against an older directory structure). Until the
 * compiler is fixed at source this single function is the authoritative fixup.
 * Apply it once per compilation, before passing code to the import rewriter.
 *
 * Pass `patterns` from `userConfig.compilerPathFixup.patterns` to override the
 * defaults. Pass an empty array to disable all fixups.
 */
export function fixSwissLibPaths(
  code: string,
  patterns?: Array<{ from: string; to: string }>,
): string {
  const activePatterns = patterns ?? [
    { from: '/swiss-lib/packages/', to: '/swiss-packages/' },
    { from: '/swiss-lib/', to: '/swiss-packages/' },
  ];
  let result = code;
  for (const { from, to } of activePatterns) {
    if (result.includes(from)) {
      result = result.split(from).join(to);
    }
  }
  return result;
}
