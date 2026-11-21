// G1's privacy layer. Three rules:
//  1. The AI sees as little as possible: phone numbers, UPI IDs, emails and card numbers are replaced
//     before anything goes to the cloud. The phone fills them in when it acts ("call Papa" works, the AI
//     never learns Papa's number). Only when the user asks to hear a saved item is it shown as is.
//  2. The owner decides what G1 may do: each kind of action can be switched off, and one switch pauses
//     every action while G1 can still talk.
//  3. Everything G1 does is written to a log on the phone that the owner can read or erase.

const HIDDEN_NUMBER = '[number saved on phone]';

/** Tools the user calls to hear their own saved data: their results go to the AI as they are. */
export const REVEAL = new Set(['find_contact', 'recall', 'read_notes', 'list_read']);

export function shieldText(s) {
  return String(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email saved on phone]')
    .replace(/\b[\w.-]{2,}@[a-z]{2,}\b/gi, '[UPI ID saved on phone]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, (m) => {
      const digits = m.replace(/\D/g, '').length;
      if (digits >= 14 && digits <= 19) return '[card number hidden]';
      return digits >= 10 && digits <= 13 ? HIDDEN_NUMBER : m; // dates, amounts and times stay
    });
}

/** Deep copy with every string shielded. */
export function shield(value) {
  if (typeof value === 'string') return shieldText(value);
  if (Array.isArray(value)) return value.map(shield);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shield(v)]));
  return value;
}

/** What goes back to the AI after a tool runs. */
export const forAI = (toolName, result) => (REVEAL.has(toolName) ? result : shield(result));

// ---------------------------------------------------------------- permissions

export const PERMISSIONS = [
  ['calls', 'Calls', 'Calls', ['call_contact']],
  ['messages', 'Messages and posts', 'Messages aur posts', ['send_message', 'send_email', 'share', 'post_video']],
  ['payments', 'Payments', 'Payments', ['pay_upi']],
  ['camera', 'Camera', 'Camera', ['look', 'take_photo', 'make_video']],
  ['location', 'Location', 'Location', ['where_am_i', 'find_nearby', 'navigate']],
  ['web', 'Web and search', 'Web aur search', ['web_search', 'read_page', 'web_lookup', 'travel_search']],
  ['memory', 'Remembering things about you', 'Tumhari baatein yaad rakhna', ['remember', 'recall', 'forget']],
];

// Harmless even when G1 is paused
const ALWAYS = new Set(['get_time', 'get_date', 'calculate', 'device_status', 'check_timers', 'list_reminders', 'activity_log']);

export const permissionOf = (tool) => PERMISSIONS.find((p) => p[3].includes(tool)) || null;

/**
 * The guard every skill runs through (see skills/index.js).
 * settings(): { paused, permissions: { calls: true, ... }, language }; store: the device store.
 */
export function createGuard({ settings, store, now = () => Date.now() }) {
  const hi = () => settings().language === 'hi-IN';
  return {
    /** null when allowed, otherwise the result to return instead of running the tool. */
    check(tool) {
      const s = settings();
      if (s.paused && !ALWAYS.has(tool)) {
        return {
          ok: false,
          say: hi() ? 'G1 abhi pause pe hai, koi kaam nahi karunga. Settings, Privacy mein chalu karo.' : "G1 is paused, so I won't do anything. Turn it back on in Settings, Privacy.",
          data: { error: 'paused' },
        };
      }
      const p = permissionOf(tool);
      if (p && s.permissions?.[p[0]] === false) {
        return {
          ok: false,
          say: hi() ? `${p[2]} ki permission band hai. Settings, Privacy mein on kar sakte ho.` : `${p[1]} is switched off. You can turn it on in Settings, Privacy.`,
          data: { error: 'permission_off', permission: p[0] },
        };
      }
      return null;
    },

    /** One line in the on-phone activity log (newest first, last 200). */
    log(tool, result, extra = {}) {
      const entry = {
        t: now(),
        tool,
        ok: result?.ok !== false,
        waiting: Boolean(result?.confirm),
        what: String(result?.confirm?.say || result?.say || '').slice(0, 160),
        ...extra,
      };
      store.update('activity', [], (a) => [entry, ...(Array.isArray(a) ? a : [])].slice(0, 200));
      return entry;
    },

    activity: () => store.get('activity', []),
    clearActivity: () => store.set('activity', []),
  };
}

/** The skills registry wraps every skill with this: check, run, log (and log the confirmed action too). */
export function guarded(skill) {
  return {
    ...skill,
    async run(args, ctx) {
      const g = ctx?.guard;
      const blocked = g?.check(skill.name);
      if (blocked) {
        g.log(skill.name, blocked, { blocked: true });
        return blocked;
      }
      const res = await skill.run(args, ctx);
      if (!g) return res;
      g.log(skill.name, res);
      if (res?.confirm?.proceed) {
        const proceed = res.confirm.proceed;
        res.confirm = {
          ...res.confirm,
          async proceed(...a) {
            const again = g.check(skill.name); // paused or switched off while waiting for the yes
            if (again) return again;
            const done = await proceed(...a);
            g.log(skill.name, done, { confirmed: true });
            return done;
          },
        };
      }
      return res;
    },
  };
}
