// Helpers shared by all skills.

/** Picks the reply text for the user's language. Telugu falls back to English in basic mode. */
export function L(ctx, en, hi) {
  return ctx.settings.get().language === 'hi-IN' && hi ? hi : en;
}

/** A reply that asks the user for a missing detail. */
export function ask(ctx, en, hi, data = {}) {
  return { ok: false, say: L(ctx, en, hi), data: { needs: 'more_information', question: L(ctx, en, hi), ...data }, expectReply: true };
}

export function fail(ctx, en, hi, data = {}) {
  return { ok: false, say: L(ctx, en, hi), data: { error: 'failed', ...data } };
}

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^\p{L}\p{N}@+.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const enc = encodeURIComponent;

export async function getJson(ctx, url, { timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await ctx.fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
