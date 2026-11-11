// Test rig: a G1 brain with fake device, fake clock and fake network.

import { createStore } from '../public/js/core/store.js';
import { createSettings } from '../public/js/core/settings.js';
import { createScheduler } from '../public/js/core/scheduler.js';
import { createSkills } from '../public/js/skills/index.js';
import { createBrain } from '../public/js/core/brain.js';

// Tuesday 10 Nov 2026, 10:00 local time
export const NOW = new Date(2026, 10, 10, 10, 0, 0);

export function makeG1({ llm = null, settings: patch = {}, routes = {}, now = NOW, core = null, phone = null } = {}) {
  const mem = new Map();
  const store = createStore({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) });
  const settings = createSettings(store);
  settings.set(patch);
  const opened = [];
  const fired = [];
  const timers = [];
  const scheduler = createScheduler({
    store,
    onFire: (item) => fired.push(item),
    now: () => now.getTime(),
    setTimer: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    clearTimer: () => {},
  });
  const fetchCalls = [];
  const ctx = {
    store,
    settings,
    scheduler,
    now: () => new Date(now),
    fetch: async (url) => {
      fetchCalls.push(String(url));
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      if (!key) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => routes[key] };
    },
    platform: {
      open: (url) => {
        opened.push(url);
        return 'opened';
      },
      geolocate: async () => ({ lat: 14.68, lon: 77.6 }),
      battery: async () => ({ level: 0.72, charging: false }),
      online: () => true,
      torch: async () => {},
      capturePhoto: async () => 'data:image/jpeg;base64,AAAA',
      savePhoto: () => {},
      // set when the test plays the Android app
      deviceContacts: () => phone?.contacts || [],
      share: (text, app) => (phone ? (phone.shared.push({ text, app }), 'opened') : 'blocked'),
      setAlarm: (h, m, label) => (phone ? (phone.alarms.push({ h, m, label }), true) : false),
    },
    vision: llm ? (img, q) => llm.see(img, q) : null,
    core,
  };
  const skills = createSkills();
  const brain = createBrain({ skills, ctx, getLLM: () => llm, timeZone: 'Asia/Kolkata' });
  return { brain, ctx, store, settings, scheduler, skills, opened, fired, timers, fetchCalls };
}

/** A scripted model: each entry is { text } or { calls: [{ name, args }] }. Records what it was sent. */
export function scriptedLLM(script) {
  const seen = [];
  let n = 0;
  return {
    seen,
    async chat(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const step = script[Math.min(n++, script.length - 1)];
      if (step.error) throw new Error(step.error);
      const message = { role: 'assistant', content: step.text || '' };
      if (step.calls) {
        message.tool_calls = step.calls.map((c, i) => ({ id: `call_${n}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) }, extra_content: { google: { thought_signature: 'sig' } } }));
      }
      return { message, text: step.text || '', toolCalls: (message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments) })) };
    },
    async see() {
      return 'A steel water bottle on a desk.';
    },
  };
}
