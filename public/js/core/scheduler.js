// Timers, alarms and reminders. Items survive a reload; they ring while G1 is open.

import { uid } from './store.js';

const MAX_DELAY = 2 ** 31 - 1;

export function createScheduler({ store, onFire, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const handles = new Map();
  const all = () => store.get('schedule', []);
  const save = (items) => store.set('schedule', items);

  function arm(item) {
    disarm(item.id);
    const delay = Math.max(0, item.at - now());
    // long waits are re-armed in steps because timers cannot wait more than about 24 days
    const handle = setTimer(() => (delay > MAX_DELAY ? arm(item) : fire(item.id)), Math.min(delay, MAX_DELAY));
    handles.set(item.id, handle);
  }

  function disarm(id) {
    if (handles.has(id)) {
      clearTimer(handles.get(id));
      handles.delete(id);
    }
  }

  function fire(id) {
    const item = all().find((x) => x.id === id);
    if (!item) return;
    save(all().filter((x) => x.id !== id));
    handles.delete(id);
    onFire?.({ ...item, lateBy: Math.max(0, now() - item.at) });
  }

  return {
    /** kind: 'timer' | 'reminder' | 'alarm' */
    add({ kind, at, text = '' }) {
      const item = { id: uid(), kind, at, text, created: now() };
      save([...all(), item]);
      arm(item);
      return item;
    },
    remove(id) {
      disarm(id);
      const before = all();
      save(before.filter((x) => x.id !== id));
      return before.some((x) => x.id === id);
    },
    list(kind) {
      return all()
        .filter((x) => !kind || x.kind === kind || (Array.isArray(kind) && kind.includes(x.kind)))
        .sort((a, b) => a.at - b.at);
    },
    /** Call once at start-up: re-arms everything, fires what was missed. */
    resume() {
      all().forEach(arm);
    },
    stop() {
      [...handles.keys()].forEach(disarm);
    },
  };
}
