// Daily life: clock, timers, alarms, reminders, notes, lists, memory, maths, settings.

import { uid } from '../core/store.js';
import { sayClock, sayDate, sayDuration, sayWhen } from '../core/datetime.js';
import { LANGUAGES, VOICE_PRESETS } from '../core/settings.js';
import { L, ask, fail, norm } from './util.js';

const lang = (ctx) => ctx.settings.get().language;

// ---- maths -----------------------------------------------------------------

/** Safe arithmetic: numbers, + - * / ^ %, brackets, and spoken forms like "15 percent of 2400". */
export function calculate(expression) {
  let s = ' ' + String(expression).toLowerCase() + ' ';
  s = s
    .replace(/,/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent|pratishat)\s*(?:of|ka|ke)\s*/g, '($1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/g, '($1/100)')
    .replace(/\b(plus|and|aur|jod)\b/g, '+')
    .replace(/\b(minus|less|ghata)\b/g, '-')
    .replace(/\b(times|multiplied by|into|guna|x)\b|×/g, '*')
    .replace(/\b(divided by|over|by|bhaag|bata)\b|÷/g, '/')
    .replace(/\b(to the power of|power)\b/g, '^')
    .replace(/\b(squared)\b/g, '^2')
    .replace(/[a-z?=]+/g, ' ')
    .trim();
  if (!s || !/\d/.test(s)) throw new Error('nothing to calculate');
  let i = 0;
  const peek = () => s[i];
  const skip = () => {
    while (s[i] === ' ') i++;
  };
  function primary() {
    skip();
    if (peek() === '(') {
      i++;
      const v = sum();
      skip();
      if (peek() !== ')') throw new Error('missing bracket');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -primary();
    }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('bad expression');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function power() {
    const base = primary();
    skip();
    if (peek() === '^') {
      i++;
      return Math.pow(base, power());
    }
    return base;
  }
  function product() {
    let v = power();
    for (;;) {
      skip();
      if (peek() === '*') {
        i++;
        v *= power();
      } else if (peek() === '/') {
        i++;
        v /= power();
      } else return v;
    }
  }
  function sum() {
    let v = product();
    for (;;) {
      skip();
      if (peek() === '+') {
        i++;
        v += product();
      } else if (peek() === '-') {
        i++;
        v -= product();
      } else return v;
    }
  }
  const value = sum();
  skip();
  if (i < s.length) throw new Error('bad expression');
  if (!Number.isFinite(value)) throw new Error('not a finite number');
  return Math.round(value * 1e6) / 1e6;
}

// ---- helpers ---------------------------------------------------------------

const listKey = (name) => {
  const n = norm(name).replace(/\b(my|the|list|mera|meri)\b/g, '').trim();
  if (/^(to ?do|todo|tasks?|kaam)$/.test(n)) return 'to-do';
  if (/^(shopping|grocery|groceries|kirana|saman|samaan)$/.test(n)) return 'shopping';
  return n || 'to-do';
};

function scheduleCard(ctx, items, title) {
  const now = ctx.now();
  return {
    type: 'list',
    title,
    items: items.slice(0, 4).map((x) => `${x.text || 'Alarm'}, ${sayWhen(new Date(x.at), now, lang(ctx))}`),
    more: Math.max(0, items.length - 4),
  };
}

export const lifeSkills = [
  {
    name: 'get_time',
    description: 'Tell the current time and date.',
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const now = ctx.now();
      return {
        ok: true,
        say: L(ctx, `It's ${sayClock(now)}.`, `Abhi ${sayClock(now)} ho rahe hain.`),
        data: { time: sayClock(now), date: sayDate(now), iso: now.toISOString() },
      };
    },
  },
  {
    name: 'get_date',
    description: "Tell today's date and day of the week.",
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const now = ctx.now();
      return { ok: true, say: L(ctx, `It's ${sayDate(now)}.`, `Aaj ${sayDate(now)} hai.`), data: { date: sayDate(now), iso: now.toISOString() } };
    },
  },
  {
    name: 'set_timer',
    description: 'Start a countdown timer.',
    parameters: {
      type: 'object',
      properties: { seconds: { type: 'number', description: 'Length in seconds' }, label: { type: 'string' } },
      required: ['seconds'],
    },
    run(args, ctx) {
      const seconds = Math.round(Number(args.seconds));
      if (!(seconds > 0)) return ask(ctx, 'For how long?', 'Kitni der ka timer?');
      const item = ctx.scheduler.add({ kind: 'timer', at: ctx.now().getTime() + seconds * 1000, text: String(args.label || '').trim() });
      const len = sayDuration(seconds, lang(ctx));
      return {
        ok: true,
        say: L(ctx, `${len}, starting now.`, `${len} ka timer shuru.`),
        data: { timer_id: item.id, seconds, label: item.text },
        card: { type: 'timer', endsAt: item.at, label: item.text || len },
      };
    },
  },
  {
    name: 'check_timers',
    description: 'Say how much time is left on running timers.',
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const timers = ctx.scheduler.list('timer');
      if (!timers.length) return { ok: true, say: L(ctx, 'No timer is running.', 'Koi timer nahi chal raha.'), data: { timers: [] } };
      const now = ctx.now().getTime();
      const parts = timers.map((t) => `${t.text ? t.text + ': ' : ''}${sayDuration(Math.max(0, (t.at - now) / 1000), lang(ctx))}`);
      return {
        ok: true,
        say: L(ctx, `${parts.join(', ')} left.`, `${parts.join(', ')} bache hain.`),
        data: { timers: timers.map((t) => ({ label: t.text, seconds_left: Math.round((t.at - now) / 1000) })) },
        card: { type: 'timer', endsAt: timers[0].at, label: timers[0].text || L(ctx, 'Timer', 'Timer') },
      };
    },
  },
  {
    name: 'cancel_timer',
    description: 'Cancel running timers. Without a label, cancels all of them.',
    parameters: { type: 'object', properties: { label: { type: 'string' } } },
    run(args, ctx) {
      let timers = ctx.scheduler.list('timer');
      if (args.label) {
        const q = norm(args.label);
        const hit = timers.filter((t) => norm(t.text).includes(q));
        if (hit.length) timers = hit;
      }
      if (!timers.length) return { ok: true, say: L(ctx, 'No timer is running.', 'Koi timer nahi chal raha.'), data: { cancelled: 0 } };
      timers.forEach((t) => ctx.scheduler.remove(t.id));
      return { ok: true, say: L(ctx, 'Timer cancelled.', 'Timer band kar diya.'), data: { cancelled: timers.length } };
    },
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder or an alarm for a specific time. G1 speaks it aloud when the time comes.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind about. Empty for a plain alarm.' },
        when_iso: { type: 'string', description: 'Local date and time in ISO 8601, e.g. 2026-11-12T07:00:00' },
        kind: { type: 'string', enum: ['reminder', 'alarm'] },
      },
      required: ['when_iso'],
    },
    run(args, ctx) {
      const kind = args.kind === 'alarm' ? 'alarm' : 'reminder';
      const text = String(args.text || '').trim();
      if (!args.when_iso) return ask(ctx, 'For what time?', 'Kitne baje?');
      const when = new Date(args.when_iso);
      const now = ctx.now();
      if (Number.isNaN(when.getTime())) return ask(ctx, 'I missed the time. When?', 'Time samajh nahi aaya. Kab?');
      if (when.getTime() <= now.getTime()) return ask(ctx, 'That time has already passed. When should it be?', 'Yeh time nikal chuka hai. Kab rakhu?');
      if (kind === 'reminder' && !text) return ask(ctx, 'What should I remind you about?', 'Kis cheez ka reminder?');
      const item = ctx.scheduler.add({ kind, at: when.getTime(), text });
      const at = sayWhen(when, now, lang(ctx));
      const say =
        kind === 'alarm'
          ? L(ctx, `Alarm set for ${at}.`, `Alarm lag gaya, ${at}.`)
          : L(ctx, `Okay, I'll remind you ${at}.`, `Theek hai, ${at} yaad dila dunga.`);
      return {
        ok: true,
        say,
        data: { id: item.id, kind, text, when: when.toISOString(), note: 'Rings while G1 is open on the device.' },
        card: { type: 'list', title: kind === 'alarm' ? L(ctx, 'Alarm', 'Alarm') : L(ctx, 'Reminder', 'Reminder'), items: [`${text || 'Alarm'}, ${at}`] },
      };
    },
  },
  {
    name: 'list_reminders',
    description: 'Read out upcoming reminders and alarms.',
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const items = ctx.scheduler.list(['reminder', 'alarm']);
      if (!items.length) return { ok: true, say: L(ctx, 'Nothing coming up.', 'Koi reminder nahi hai.'), data: { reminders: [] } };
      const now = ctx.now();
      const spoken = items.slice(0, 3).map((x) => `${x.text || 'alarm'} ${sayWhen(new Date(x.at), now, lang(ctx))}`);
      const extra = items.length > 3 ? L(ctx, `, and ${items.length - 3} more`, `, aur ${items.length - 3}`) : '';
      return {
        ok: true,
        say: L(ctx, `You have ${spoken.join(', ')}${extra}.`, `${spoken.join(', ')}${extra}.`),
        data: { reminders: items.map((x) => ({ kind: x.kind, text: x.text, when: new Date(x.at).toISOString() })) },
        card: scheduleCard(ctx, items, L(ctx, 'Coming up', 'Aane wale')),
      };
    },
  },
  {
    name: 'delete_reminder',
    description: 'Delete reminders or alarms that match some words. Use query "all" to clear everything.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run(args, ctx) {
      const q = norm(args.query);
      const items = ctx.scheduler.list(['reminder', 'alarm']);
      const hit = !q || /^(all|sab|everything|saare)$/.test(q) ? items : items.filter((x) => norm(x.text || 'alarm').includes(q) || q.includes(x.kind));
      if (!hit.length) return fail(ctx, "I couldn't find that reminder.", 'Aisa koi reminder nahi mila.', { error: 'not_found' });
      hit.forEach((x) => ctx.scheduler.remove(x.id));
      return { ok: true, say: L(ctx, hit.length > 1 ? `Removed ${hit.length} reminders.` : 'Removed it.', hit.length > 1 ? `${hit.length} reminders hata diye.` : 'Hata diya.'), data: { deleted: hit.length } };
    },
  },
  {
    name: 'add_note',
    description: 'Save a note in the user\'s words.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run(args, ctx) {
      const text = String(args.text || '').trim();
      if (!text) return ask(ctx, 'What should I note down?', 'Kya note karu?');
      ctx.store.update('notes', [], (n) => [{ id: uid(), text, at: ctx.now().getTime() }, ...n]);
      return { ok: true, say: L(ctx, 'Noted.', 'Note kar liya.'), data: { saved: text }, card: { type: 'list', title: L(ctx, 'Note', 'Note'), items: [text] } };
    },
  },
  {
    name: 'read_notes',
    description: 'Read back saved notes, newest first. Optional words to search for.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    run(args, ctx) {
      let notes = ctx.store.get('notes', []);
      const q = norm(args.query);
      if (q) notes = notes.filter((n) => norm(n.text).includes(q));
      if (!notes.length) return { ok: true, say: L(ctx, q ? 'No note about that.' : 'You have no notes yet.', q ? 'Iske baare mein koi note nahi hai.' : 'Abhi koi note nahi hai.'), data: { notes: [] } };
      const spoken = notes.slice(0, 3).map((n) => n.text).join('. ');
      const extra = notes.length > 3 ? L(ctx, ` And ${notes.length - 3} more.`, ` Aur ${notes.length - 3} hain.`) : '';
      return {
        ok: true,
        say: `${spoken}.${extra}`,
        data: { notes: notes.slice(0, 20).map((n) => n.text) },
        card: { type: 'list', title: L(ctx, 'Notes', 'Notes'), items: notes.slice(0, 4).map((n) => n.text), more: Math.max(0, notes.length - 4) },
      };
    },
  },
  {
    name: 'delete_note',
    description: 'Delete notes that contain some words. Use query "all" to delete every note.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run(args, ctx) {
      const q = norm(args.query);
      const notes = ctx.store.get('notes', []);
      const all = !q || /^(all|sab|everything|saare)$/.test(q);
      const hit = all ? notes : notes.filter((n) => norm(n.text).includes(q));
      if (!hit.length) return fail(ctx, "I couldn't find that note.", 'Aisa koi note nahi mila.', { error: 'not_found' });
      const remove = () => {
        const ids = new Set(hit.map((n) => n.id));
        ctx.store.set('notes', notes.filter((n) => !ids.has(n.id)));
        return { ok: true, say: L(ctx, hit.length > 1 ? `Deleted ${hit.length} notes.` : 'Deleted.', hit.length > 1 ? `${hit.length} notes hata diye.` : 'Hata diya.'), data: { deleted: hit.length } };
      };
      if (hit.length > 1) return { confirm: { say: L(ctx, `Delete ${hit.length} notes?`, `${hit.length} notes hata du?`), proceed: remove } };
      return remove();
    },
  },
  {
    name: 'list_add',
    description: 'Add one or more items to a named list such as shopping or to-do.',
    parameters: {
      type: 'object',
      properties: { list: { type: 'string', description: 'List name, e.g. shopping, to-do' }, items: { type: 'array', items: { type: 'string' } } },
      required: ['list', 'items'],
    },
    run(args, ctx) {
      const key = listKey(args.list);
      const items = (Array.isArray(args.items) ? args.items : [args.items]).map((x) => String(x || '').trim()).filter(Boolean);
      if (!items.length) return ask(ctx, 'What should I add?', 'Kya add karu?');
      const lists = ctx.store.update('lists', {}, (all) => ({ ...all, [key]: [...(all[key] || []), ...items] }));
      return {
        ok: true,
        say: L(ctx, `Added to your ${key} list.`, `${key} list mein daal diya.`),
        data: { list: key, items: lists[key] },
        card: { type: 'list', title: key, items: lists[key].slice(-4), more: Math.max(0, lists[key].length - 4) },
      };
    },
  },
  {
    name: 'list_read',
    description: 'Read a named list.',
    parameters: { type: 'object', properties: { list: { type: 'string' } }, required: ['list'] },
    run(args, ctx) {
      const key = listKey(args.list);
      const items = ctx.store.get('lists', {})[key] || [];
      if (!items.length) return { ok: true, say: L(ctx, `Your ${key} list is empty.`, `${key} list khaali hai.`), data: { list: key, items: [] } };
      return {
        ok: true,
        say: L(ctx, `On your ${key} list: ${items.join(', ')}.`, `${key} list mein hai: ${items.join(', ')}.`),
        data: { list: key, items },
        card: { type: 'list', title: key, items: items.slice(0, 5), more: Math.max(0, items.length - 5) },
      };
    },
  },
  {
    name: 'list_remove',
    description: 'Remove an item from a named list, or clear the whole list with item "all".',
    parameters: { type: 'object', properties: { list: { type: 'string' }, item: { type: 'string' } }, required: ['list', 'item'] },
    run(args, ctx) {
      const key = listKey(args.list);
      const q = norm(args.item);
      const lists = ctx.store.get('lists', {});
      const items = lists[key] || [];
      const all = /^(all|sab|everything)$/.test(q);
      const next = all ? [] : items.filter((x) => !norm(x).includes(q));
      if (next.length === items.length) return fail(ctx, `That's not on your ${key} list.`, `Yeh ${key} list mein nahi hai.`, { error: 'not_found' });
      ctx.store.set('lists', { ...lists, [key]: next });
      return { ok: true, say: L(ctx, all ? `Cleared your ${key} list.` : 'Removed.', all ? `${key} list khaali kar di.` : 'Hata diya.'), data: { list: key, items: next } };
    },
  },
  {
    name: 'remember',
    description: 'Remember a lasting fact about the user (preferences, people, places) so future answers can use it.',
    parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
    run(args, ctx) {
      const fact = String(args.fact || '').trim();
      if (!fact) return ask(ctx, 'What should I remember?', 'Kya yaad rakhu?');
      ctx.store.update('memory', [], (m) => [...m.filter((x) => norm(x) !== norm(fact)), fact].slice(-60));
      return { ok: true, say: L(ctx, "Got it, I'll remember that.", 'Theek hai, yaad rakhunga.'), data: { remembered: fact } };
    },
  },
  {
    name: 'recall',
    description: 'List what G1 has been asked to remember about the user.',
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const facts = ctx.store.get('memory', []);
      if (!facts.length) return { ok: true, say: L(ctx, "You haven't asked me to remember anything yet.", 'Abhi tak kuch yaad rakhne ko nahi bola.'), data: { facts: [] } };
      return { ok: true, say: facts.slice(-4).join('. ') + '.', data: { facts }, card: { type: 'list', title: L(ctx, 'I remember', 'Yaad hai'), items: facts.slice(-4) } };
    },
  },
  {
    name: 'forget',
    description: 'Forget remembered facts that contain some words. Use query "all" to forget everything.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run(args, ctx) {
      const q = norm(args.query);
      const facts = ctx.store.get('memory', []);
      const next = /^(all|sab|everything)$/.test(q) ? [] : facts.filter((f) => !norm(f).includes(q));
      if (next.length === facts.length) return fail(ctx, "I don't have anything like that.", 'Aisa kuch yaad nahi hai.', { error: 'not_found' });
      ctx.store.set('memory', next);
      return { ok: true, say: L(ctx, 'Forgotten.', 'Bhool gaya.'), data: { forgotten: facts.length - next.length } };
    },
  },
  {
    name: 'calculate',
    description: 'Do arithmetic exactly. Accepts an expression such as "15% of 2400" or "(120 + 80) / 4".',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    run(args, ctx) {
      try {
        const value = calculate(args.expression);
        const shown = value.toLocaleString('en-IN', { maximumFractionDigits: 4 });
        return { ok: true, say: L(ctx, `That's ${shown}.`, `${shown} hota hai.`), data: { result: value }, card: { type: 'info', title: shown, text: String(args.expression).trim() } };
      } catch {
        return fail(ctx, "I couldn't work that out. Say it once more?", 'Yeh calculate nahi ho paya. Ek baar aur bolo?', { error: 'bad_expression' });
      }
    },
  },
  {
    name: 'update_settings',
    description: "Change G1's own settings by voice: the user's name, spoken language, G1's voice, speaking speed, hands-free listening, home city.",
    parameters: {
      type: 'object',
      properties: {
        user_name: { type: 'string' },
        language: { type: 'string', enum: ['english', 'hindi', 'telugu'] },
        voice: { type: 'string', description: '"next" to switch to another voice, or a voice name' },
        speed: { type: 'string', enum: ['slower', 'normal', 'faster'] },
        handsfree: { type: 'boolean' },
        home_city: { type: 'string' },
      },
    },
    run(args, ctx) {
      const s = ctx.settings.get();
      const patch = {};
      const said = [];
      if (args.user_name) {
        patch.userName = String(args.user_name).trim().replace(/^\w/, (c) => c.toUpperCase());
        said.push(L(ctx, `Nice to meet you, ${patch.userName}.`, `Theek hai ${patch.userName}.`));
      }
      if (args.language) {
        const id = { english: 'en-IN', hindi: 'hi-IN', telugu: 'te-IN' }[String(args.language).toLowerCase()];
        if (id) {
          patch.language = id;
          said.push(id === 'hi-IN' ? 'Theek hai, ab Hindi mein baat karte hain.' : `Okay, ${LANGUAGES.find((x) => x.id === id).label} it is.`);
        }
      }
      if (args.voice) {
        const q = norm(args.voice);
        const idx = VOICE_PRESETS.findIndex((p) => p.id === s.tts.preset);
        const named = VOICE_PRESETS.find((p) => q.includes(p.id));
        const next = named || VOICE_PRESETS[(idx + 1) % VOICE_PRESETS.length];
        patch.tts = { ...(patch.tts || {}), preset: next.id, voiceId: '', browserVoice: '' };
        said.push(L(ctx, 'How does this voice sound?', 'Yeh awaaz kaisi lag rahi hai?'));
      }
      if (args.speed) {
        const rate = { slower: Math.max(0.8, s.tts.rate - 0.1), normal: 1, faster: Math.min(1.3, s.tts.rate + 0.1) }[args.speed] ?? 1;
        patch.tts = { ...(patch.tts || {}), rate: Math.round(rate * 100) / 100 };
        said.push(L(ctx, 'Okay, like this.', 'Theek hai, aise.'));
      }
      if (typeof args.handsfree === 'boolean') {
        patch.handsfree = args.handsfree;
        said.push(args.handsfree ? L(ctx, 'Hands-free is on. Just say "Hey G1".', 'Hands-free chalu. Bas "Hey G1" bolo.') : L(ctx, 'Hands-free is off.', 'Hands-free band.'));
      }
      if (args.home_city) {
        patch.homeCity = String(args.home_city).trim();
        said.push(L(ctx, `Home is ${patch.homeCity}.`, `Ghar ${patch.homeCity} set kar diya.`));
      }
      if (!said.length) return ask(ctx, 'What should I change?', 'Kya badalna hai?');
      ctx.settings.set(patch);
      return { ok: true, say: said.join(' '), data: { changed: Object.keys(patch) } };
    },
  },
];
