// The G1 Android app exposes window.G1Native. In a plain browser this is null and G1 uses web APIs.

export const native = globalThis.G1Native || null;

/** Calls a native method if the app has it. Returns undefined otherwise. */
export function nativeCall(method, ...args) {
  try {
    if (native && typeof native[method] === 'function') return native[method](...args);
  } catch {
    /* fall back to the web way */
  }
  return undefined;
}

export function nativeJson(method, fallback, ...args) {
  const raw = nativeCall(method, ...args);
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Listen for events from the Android app: 'speech', 'tts', 'permissions'. Returns an unsubscribe function. */
export function onNative(type, fn) {
  const handler = (e) => e.detail?.type === type && fn(e.detail);
  globalThis.addEventListener?.('g1native', handler);
  return () => globalThis.removeEventListener?.('g1native', handler);
}

export const has = (method) => Boolean(native && typeof native[method] === 'function');
