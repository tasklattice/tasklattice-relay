export function canonicalLocation(
  currentHref: string,
  canonicalOrigin: string,
): string | null {
  const current = new URL(currentHref);
  const canonical = new URL(canonicalOrigin);
  if (current.origin === canonical.origin) return null;

  const target = new URL(canonical.origin);
  target.pathname = current.pathname;
  target.search = current.search;
  target.hash = current.hash;
  return target.href;
}
