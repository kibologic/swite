/**
 * CDN fallback policy.
 *
 * Swite can fall back to jsDelivr (+esm) for packages it can't resolve locally.
 * This must be safe and project-agnostic:
 * - Unscoped packages (e.g. "react") are usually public on npm; allow by default.
 * - Scoped packages (e.g. "@scope/pkg") may be private; do NOT CDN-fallback by default.
 *
 * Opt-in:
 * - Set `SWITE_CDN_FALLBACK_SCOPES` to a comma-separated list of scopes to allow,
 *   e.g. "@types,@tanstack".
 */

function getScope(specifierOrPkg: string): string | null {
  if (!specifierOrPkg.startsWith("@")) return null;
  const firstSlash = specifierOrPkg.indexOf("/");
  if (firstSlash === -1) return null;
  return specifierOrPkg.slice(0, firstSlash); // "@scope"
}

function parseAllowList(): Set<string> {
  const raw = process.env.SWITE_CDN_FALLBACK_SCOPES || "";
  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("@") ? s : `@${s}`));
  return new Set(scopes);
}

export function shouldUseCdnFallback(specifierOrPkg: string): boolean {
  const scope = getScope(specifierOrPkg);
  if (!scope) return true; // unscoped: allow by default
  const allow = parseAllowList();
  return allow.has(scope);
}

