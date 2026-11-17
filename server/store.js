// Storage for the G1 agent: Upstash Redis over its REST API (free tier, added from Vercel → Storage).
// Without Redis settings it falls back to memory, which is fine for tests but forgets everything on Vercel.

export function createStore(env = {}, fetchImpl = fetch) {
  const keys = Object.keys(env);
  const find = (test) => env[keys.find((k) => test(k) && env[k])];
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || find((k) => /_REST_API_URL$|REDIS_REST_URL$/.test(k)) || '').replace(/\/+$/, '');
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || find((k) => /_REST_API_TOKEN$|REDIS_REST_TOKEN$/.test(k) && !/READ_ONLY/.test(k));

  if (url && token) {
    return {
      kind: 'redis',
      async cmd(...args) {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(args.map(String)),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error('storage: ' + (j.error || res.status));
        return j.result;
      },
    };
  }

  const kv = new Map();
  const zs = new Map();
  return {
    kind: 'memory',
    async cmd(op, ...a) {
      switch (String(op).toUpperCase()) {
        case 'GET':
          return kv.has(a[0]) ? kv.get(a[0]) : null;
        case 'SET':
          if (a.includes('NX') && kv.has(a[0])) return null;
          kv.set(a[0], String(a[1]));
          return 'OK';
        case 'DEL':
          return (kv.delete(a[0]) ? 1 : 0) + (zs.delete(a[0]) ? 1 : 0);
        case 'ZADD': {
          const m = zs.get(a[0]) || new Map();
          m.set(String(a[2]), Number(a[1]));
          zs.set(a[0], m);
          return 1;
        }
        case 'ZREM':
          return zs.get(a[0])?.delete(String(a[1])) ? 1 : 0;
        case 'ZRANGEBYSCORE': {
          const lo = a[1] === '-inf' ? -Infinity : Number(a[1]);
          const hi = a[2] === '+inf' ? Infinity : Number(a[2]);
          return [...(zs.get(a[0]) || [])].filter(([, s]) => s >= lo && s <= hi).sort((x, y) => x[1] - y[1]).map(([k]) => k);
        }
        default:
          throw new Error('memory store: unsupported ' + op);
      }
    },
  };
}

export async function getJson(store, key, fallback) {
  const raw = await store.cmd('GET', key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export const setJson = (store, key, value) => store.cmd('SET', key, JSON.stringify(value));
