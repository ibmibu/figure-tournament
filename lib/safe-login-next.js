// Validate OAuth "next" against the current site origin before client routing.
// Return a canonical relative URL; never pass untrusted raw input to router.replace.
export function safeLoginNext(value, origin) {
  if (typeof value !== 'string' || !value || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  // Encoded separators can acquire navigation semantics after another decode.
  if (/%(?:2f|5c)/i.test(value)) return '/';
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return '/';
    const target = new URL(value, base.origin);
    if (target.origin !== base.origin || target.username || target.password) return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}
