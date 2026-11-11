// G1 app: wires ears, brain, voice and screen together.

import { createStore } from './core/store.js';
import { createSettings, VOICE_PRESETS, LLM_PRESETS } from './core/settings.js';
import { createScheduler } from './core/scheduler.js';
import { createBrain } from './core/brain.js';
import { createLLM } from './core/llm.js';
import { createCoreLink } from './core/corelink.js';
import { hasWake } from './core/nlu.js';
import { sayClock } from './core/datetime.js';
import { createSkills } from './skills/index.js';
import { createPlatform } from './platform.js';
import { createVoice } from './voice/tts.js';
import { createEars } from './voice/stt.js';
import { createBloom, createCardView } from './ui.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const store = createStore();
const settings = createSettings(store);
const platform = createPlatform();
const skills = createSkills();
let server = {};
let state = 'idle';
let busy = false;
let followUpUntil = 0;
let queued = '';

const hi = () => settings.get().language === 'hi-IN';
const T = (en, hin) => (hi() ? hin : en);

// ---------- screen ----------
const bloom = createBloom($('bloom'));
const cardView = createCardView($('card'), {
  onYes: () => hear('yes'),
  onNo: () => hear('no'),
  labels: () => ({ yes: T('Yes, do it', 'Haan, karo'), no: T('No', 'Nahi') }),
});

function setState(next) {
  state = next;
  screen.dataset.state = next;
  bloom.set(next);
  $('mic').setAttribute('aria-label', next === 'listening' ? 'Stop listening' : next === 'speaking' ? 'Stop talking and listen' : 'Talk to G1');
  $('hint').textContent =
    next === 'listening' ? T('Listening', 'Sun raha hu') : next === 'thinking' ? T('One second', 'Ek second') : next === 'speaking' ? T('Tap to interrupt', 'Rokne ke liye tap karo') : idleHint();
}

function idleHint() {
  if (!ears.supported) return T('This browser has no voice input. Type instead, or open G1 in Chrome.', 'Is browser mein voice nahi hai. Type karo, ya G1 ko Chrome mein kholo.');
  return settings.get().handsfree ? T('Say "Hey G1", or tap', '"Hey G1" bolo, ya tap karo') : T('Tap and talk', 'Tap karke bolo');
}

function notice(text) {
  $('notice').textContent = text || '';
  $('notice').hidden = !text;
}

function refreshStatus() {
  $('clock').textContent = sayClock(new Date()).replace(/ (AM|PM)$/, '');
  $('mode').textContent = getLLM() ? 'AI' : T('Basic', 'Basic');
  platform
    .battery()
    .then((b) => ($('battery').textContent = Math.round(b.level * 100) + '%'))
    .catch(() => {});
}

// ---------- brain ----------
let llmCache = { key: '', llm: null };
function getLLM() {
  const cfg = settings.llmConfig(server);
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (llmCache.key !== key) llmCache = { key, llm: createLLM(cfg) };
  return llmCache.llm;
}

const scheduler = createScheduler({ store, onFire: announce });
const ctx = {
  store,
  settings,
  scheduler,
  platform,
  now: () => new Date(),
  fetch: (...a) => fetch(...a),
  core: createCoreLink({ getServer: () => server, settings }),
  get vision() {
    const llm = getLLM();
    return llm ? (photo, q) => llm.see(photo, q, 'You are G1, speaking aloud. Answer in one or two short spoken sentences, in the language of the question. No markdown.') : null;
  },
};
const brain = createBrain({ skills, ctx, getLLM, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

// ---------- voice ----------
const voice = createVoice({ settings, getServer: () => server });
const ears = createEars({
  settings,
  onInterim(text) {
    $('heard').textContent = text;
    bloom.pulse();
  },
  onFinal(text, { handsfree }) {
    // hands-free: act only when called by name, or right after G1 asked something
    if (handsfree && !hasWake(text) && Date.now() > followUpUntil && !brain.hasPending()) {
      $('heard').textContent = '';
      return;
    }
    hear(text);
  },
  onState(listening) {
    if (listening && !busy) setState('listening');
    else if (!listening && state === 'listening') setState('idle');
  },
  onError(kind) {
    const messages = {
      'mic-blocked': T('The microphone is blocked. Allow it for this site, then tap the button.', 'Microphone band hai. Is site ke liye allow karo, phir button dabao.'),
      'no-mic': T('No microphone found.', 'Microphone nahi mila.'),
      'no-network': T('Voice input needs the internet in this browser.', 'Is browser mein voice ke liye internet chahiye.'),
      unsupported: T('This browser has no voice input. Type instead, or open G1 in Chrome.', 'Is browser mein voice nahi hai. Type karo, ya Chrome mein kholo.'),
      'handsfree-stopped': T('Hands-free stopped. Tap to talk.', 'Hands-free ruk gaya. Tap karke bolo.'),
    };
    notice(messages[kind] || '');
    if (kind === 'unsupported') showTypebar(true);
    setState('idle');
  },
});

/** Everything the user says or types comes through here. */
async function hear(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (busy) {
    // G1 is mid-answer: cut it short and take the new request next
    queued = text;
    voice.stop();
    return;
  }
  busy = true;
  ears.pause();
  voice.stop();
  notice('');
  $('heard').textContent = text;
  setState('thinking');
  let reply;
  try {
    reply = await brain.handle(text);
  } catch (e) {
    reply = { say: T('Something went wrong. Try once more?', 'Kuch gadbad ho gayi. Ek baar aur?') };
    console.error(e);
  }
  await present(reply);
  busy = false;
  if (queued) {
    const next = queued;
    queued = '';
    return hear(next);
  }
  afterReply(reply);
}

async function present(reply) {
  if (reply.notice) notice(T('AI brain: ', 'AI: ') + reply.notice);
  if (reply.stop) {
    $('said').textContent = '';
    cardView.clear();
    setState('idle');
    return;
  }
  $('said').textContent = reply.say || '';
  cardView.show(reply.card || null);
  refreshStatus();
  if (reply.say) {
    setState('speaking');
    await voice.speak(reply.say);
  }
  if (voice.lastError && voice.engine() === 'device' && settings.get().tts.elevenKey) notice(T('Natural voice is unavailable, using the device voice.', 'Natural awaaz abhi nahi mil rahi, device ki awaaz chal rahi hai.'));
  setState('idle');
}

function afterReply(reply) {
  if (reply?.expectReply) followUpUntil = Date.now() + 12000;
  if (settings.get().handsfree) ears.startHandsfree();
  else if (reply?.expectReply && ears.supported) ears.listenOnce(); // G1 asked a question: listen for the answer
}

/** A timer, alarm or reminder is due. */
async function announce(item) {
  const late = item.lateBy > 90000;
  let say;
  if (item.kind === 'timer') say = T(`Time's up${item.text ? ` for ${item.text}` : ''}.`, `${item.text ? item.text + ' ka ' : ''}timer poora ho gaya.`);
  else if (item.kind === 'alarm') say = T(`It's ${sayClock(new Date(item.at))}. This is your alarm.`, `${sayClock(new Date(item.at))} ho gaye. Alarm.`);
  else say = late ? T(`You had a reminder earlier: ${item.text}.`, `Pehle ek reminder tha: ${item.text}.`) : T(`Reminder: ${item.text}.`, `Reminder: ${item.text}.`);
  platform.vibrate([300, 150, 300]);
  platform.notify('G1', say);
  if (busy) return setTimeout(() => announce(item), 3000);
  busy = true;
  ears.pause();
  await present({ say, card: { type: 'list', title: item.kind === 'timer' ? 'Timer' : item.kind === 'alarm' ? 'Alarm' : 'Reminder', items: [item.text || sayClock(new Date(item.at))] } });
  busy = false;
  afterReply(null);
}

// ---------- controls ----------
function micPressed() {
  voice.unlock();
  if (state === 'listening') return ears.finish();
  if (state === 'thinking') return;
  if (state === 'speaking') voice.stop();
  if (!ears.supported) {
    showTypebar(true);
    return notice(T('This browser has no voice input. Type instead, or open G1 in Chrome.', 'Is browser mein voice nahi hai. Type karo, ya Chrome mein kholo.'));
  }
  $('heard').textContent = '';
  ears.listenOnce();
}

function showTypebar(on) {
  $('typebar').hidden = !on;
  $('keys').setAttribute('aria-pressed', String(on));
  if (on) $('typed').focus();
}

$('mic').addEventListener('click', micPressed);
$('keys').addEventListener('click', () => showTypebar($('typebar').hidden));
$('typebar').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('typed').value;
  $('typed').value = '';
  voice.unlock();
  hear(text);
});
$('examples').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !$('start').hidden) return;
  voice.unlock();
  hear(b.textContent);
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || /INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName || '') || !$('start').hidden || $('settings').open) return;
  e.preventDefault();
  if (state !== 'listening') micPressed();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && state === 'listening' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) ears.finish();
});

$('startBtn').addEventListener('click', async () => {
  voice.unlock();
  $('start').hidden = true;
  store.set('started', true);
  const hello = brain.greet();
  busy = true;
  await present({ say: hello });
  busy = false;
  afterReply({ expectReply: true });
});

// ---------- settings ----------
const form = $('settingsForm');
function fillSettings() {
  const s = settings.get();
  const f = form.elements;
  f.userName.value = s.userName;
  f.language.value = s.language;
  f.homeCity.value = s.homeCity;
  f.handsfree.checked = s.handsfree;
  f.provider.value = s.llm.provider;
  f.apiKey.value = s.llm.apiKey;
  f.model.value = s.llm.model;
  f.baseUrl.value = s.llm.baseUrl;
  f.elevenKey.value = s.tts.elevenKey;
  f.rate.value = s.tts.rate;
  f.passcode.value = s.passcode;
  f.preset.replaceChildren(...VOICE_PRESETS.map((p) => new Option(p.label, p.id, false, p.id === s.tts.preset)));
  f.browserVoice.replaceChildren(new Option('Best available', ''), ...voice.deviceVoices().slice(0, 12).map((v) => new Option(`${v.name} (${v.lang})`, v.name, false, v.name === s.tts.browserVoice)));
  form.querySelector('[data-only="custom"]').hidden = s.llm.provider !== 'custom';
  $('brainStatus').textContent = server.llm
    ? 'AI is on through your G1 server. A key here is optional.'
    : getLLM()
      ? `AI is on: ${LLM_PRESETS[s.llm.provider]?.label || 'custom service'}.`
      : 'Basic mode understands everyday commands. Add an AI key for open conversation, any language, and camera questions.';
  $('voiceStatus').textContent =
    voice.engine() === 'natural' ? 'Natural voice is on.' : 'Using this device\'s voice. Add an ElevenLabs key for the natural, human-sounding one.';
}
function readSettings() {
  const f = form.elements;
  return {
    userName: f.userName.value.trim(),
    language: f.language.value,
    homeCity: f.homeCity.value.trim(),
    handsfree: f.handsfree.checked,
    passcode: f.passcode.value.trim(),
    llm: { provider: f.provider.value, apiKey: f.apiKey.value.trim(), model: f.model.value.trim(), baseUrl: f.baseUrl.value.trim() },
    tts: { elevenKey: f.elevenKey.value.trim(), preset: f.preset.value, voiceId: '', browserVoice: f.browserVoice.value, rate: Number(f.rate.value) || 1 },
  };
}
$('gear').addEventListener('click', () => {
  voice.stop();
  ears.pause();
  fillSettings();
  $('settings').show();
});
form.elements.provider.addEventListener('change', (e) => (form.querySelector('[data-only="custom"]').hidden = e.target.value !== 'custom'));
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue === 'save') settings.set(readSettings());
  refreshStatus();
  setState('idle');
  if (settings.get().handsfree && $('start').hidden) ears.startHandsfree();
  else ears.stopHandsfree();
});
$('hearIt').addEventListener('click', () => {
  settings.set(readSettings());
  voice.unlock();
  voice.speak(T("Hey, it's G1. This is how I sound.", 'Hey, main G1 hu. Meri awaaz aisi hai.'));
});
$('erase').addEventListener('click', () => {
  if (!confirm('Erase all G1 contacts, notes, reminders and settings on this device?')) return;
  scheduler.stop();
  Object.keys(localStorage).filter((k) => k.startsWith('g1:')).forEach((k) => localStorage.removeItem(k));
  location.reload();
});

// ---------- start ----------
async function boot() {
  setState('idle');
  refreshStatus();
  setInterval(refreshStatus, 20000);
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (res.ok) server = await res.json();
  } catch {
    server = {}; // plain static hosting: keys live in settings on the device
  }
  refreshStatus();
  scheduler.resume();
  if (!ears.supported) showTypebar(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  globalThis.g1 = { brain, hear, settings, store, skills, voice, ears, get server() { return server; } };
  document.documentElement.dataset.ready = 'true';
}
boot();
