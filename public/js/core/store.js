// Small JSON key-value store. Uses localStorage on a device, memory elsewhere (tests).

function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export function createStore(backend, prefix = 'g1:') {
  let b = backend;
  if (!b) {
    try {
      b = globalThis.localStorage;
      b.getItem('g1:probe');
    } catch {
      b = null;
    }
  }
  if (!b) b = memoryBackend();

  return {
    get(key, fallback = null) {
      try {
        const raw = b.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        b.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* storage full or blocked: keep running */
      }
      return value;
    },
    update(key, fallback, fn) {
      return this.set(key, fn(this.get(key, fallback)));
    },
    remove(key) {
      try {
        b.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
