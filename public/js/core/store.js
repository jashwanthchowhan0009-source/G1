// Small JSON key-value store. Uses localStorage on a device, memory elsewhere (tests).
// With a sealer (the Android app's hardware keystore) every value is encrypted before it is saved.

function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export function createStore(backend, prefix = 'g1:', sealer = null) {
  const SEALED = 'v1:';
  const cache = new Map();
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
    sealed: Boolean(sealer),
    get(key, fallback = null) {
      if (cache.has(key)) return JSON.parse(cache.get(key));
      try {
        let raw = b.getItem(prefix + key);
        if (raw == null) return fallback;
        if (raw.startsWith(SEALED)) {
          raw = sealer?.open(raw.slice(SEALED.length));
          if (raw == null) return fallback; // a different phone or a lost key: unreadable, by design
        }
        cache.set(key, raw);
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        cache.set(key, raw);
        const sealed = sealer?.seal(raw);
        b.setItem(prefix + key, sealed ? SEALED + sealed : raw);
      } catch {
        /* storage full or blocked: keep running */
      }
      return value;
    },
    /** Every key G1 keeps (without the prefix). */
    keys() {
      const out = [];
      try {
        for (let i = 0; i < (b.length ?? 0); i++) {
          const k = b.key(i);
          if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
        }
      } catch {
        /* not listable */
      }
      return out;
    },
    /** Encrypts anything saved before the vault existed. Returns how many values it sealed. */
    sealAll() {
      if (!sealer) return 0;
      let n = 0;
      for (const k of this.keys()) {
        const raw = b.getItem(prefix + k);
        if (raw != null && !raw.startsWith(SEALED)) {
          this.set(k, this.get(k));
          n++;
        }
      }
      return n;
    },
    /** Deletes everything G1 keeps on this device. */
    wipe() {
      for (const k of this.keys()) b.removeItem(prefix + k);
      cache.clear();
    },
    update(key, fallback, fn) {
      return this.set(key, fn(this.get(key, fallback)));
    },
    remove(key) {
      cache.delete(key);
      try {
        b.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
