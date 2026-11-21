// "What did you do today?": G1 reads back its own on-phone activity log.

import { L } from './util.js';

const time = (t, lang) => new Date(t).toLocaleTimeString(lang === 'hi-IN' ? 'en-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });

export const privacySkills = [
  {
    name: 'activity_log',
    description: "Read back what G1 did recently (calls, messages, payments, searches), from the log kept on this phone. Use when the user asks what G1 did or wants to check G1's actions.",
    parameters: { type: 'object', properties: { count: { type: 'number', description: 'How many recent actions, default 5' } } },
    run(args, ctx) {
      const lang = ctx.settings.get().language;
      const items = (ctx.guard?.activity() || []).filter((a) => a.tool !== 'activity_log' && a.what);
      const n = Math.min(Math.max(Number(args.count) || 5, 1), 15);
      if (!items.length) return { ok: true, say: L(ctx, "I haven't done anything yet.", 'Maine abhi tak kuch nahi kiya.'), data: { actions: [] } };
      const recent = items.slice(0, n);
      const lines = recent.map((a) => `${time(a.t, lang)}: ${a.what}${a.blocked ? ' (blocked)' : ''}`);
      return {
        ok: true,
        say: L(ctx, `Here's what I did: ${lines.join('. ')}.`, `Maine ye kiya: ${lines.join('. ')}.`),
        data: { actions: recent.map((a) => ({ time: time(a.t, lang), tool: a.tool, what: a.what, ok: a.ok, blocked: Boolean(a.blocked) })) },
      };
    },
  },
];
