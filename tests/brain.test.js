import test from 'node:test';
import assert from 'node:assert/strict';
import { makeG1, scriptedLLM, NOW } from './helpers.js';
import { createLLM } from '../public/js/core/llm.js';
import { buildSystemPrompt, forSpeech } from '../public/js/core/persona.js';
import { intlNumber } from '../public/js/skills/comm.js';
import { createScheduler } from '../public/js/core/scheduler.js';
import { createStore } from '../public/js/core/store.js';

const WEATHER_ROUTES = {
  'geocoding-api.open-meteo.com': { results: [{ name: 'Hyderabad', latitude: 17.38, longitude: 78.47 }] },
  'api.open-meteo.com/v1/forecast': {
    current: { temperature_2m: 27.6, apparent_temperature: 29, weather_code: 2, relative_humidity_2m: 60, wind_speed_10m: 9 },
    daily: { weather_code: [2, 63], temperature_2m_max: [31.2, 28.4], temperature_2m_min: [19.8, 20.1], precipitation_probability_max: [10, 70] },
  },
};

test('basic mode: save a contact, then call them', async () => {
  const g = makeG1();
  let r = await g.brain.handle('call ravi');
  assert.match(r.say, /don't have ravi saved/i);
  assert.equal(g.opened.length, 0);
  r = await g.brain.handle('save ravi number 98765 43210');
  assert.match(r.say, /Saved ravi/i);
  r = await g.brain.handle('Hey G1, call Ravi');
  assert.match(r.say, /Calling ravi/i);
  assert.deepEqual(g.opened, ['tel:+919876543210']);
  assert.equal(r.card.type, 'action');
});

test('basic mode: a WhatsApp is read back and only goes after a yes', async () => {
  const g = makeG1();
  await g.brain.handle('save mummy number 9000011111');
  let r = await g.brain.handle('mummy ko whatsapp karo ki main late aaunga');
  assert.equal(r.expectReply, true);
  assert.match(r.say, /main late aaunga/);
  assert.equal(g.opened.length, 0, 'nothing is opened before the yes');
  r = await g.brain.handle('haan bhej do');
  assert.deepEqual(g.opened, ['https://wa.me/919000011111?text=main%20late%20aaunga']);
  assert.match(r.say, /WhatsApp/);
});

test('basic mode: saying no cancels, and a new request replaces a waiting one', async () => {
  const g = makeG1();
  await g.brain.handle('save ravi number 9876543210');
  await g.brain.handle('tell ravi that i am outside');
  let r = await g.brain.handle('nahi');
  assert.match(r.say, /won't/);
  assert.equal(g.opened.length, 0);
  await g.brain.handle('tell ravi that i am outside');
  r = await g.brain.handle('what time is it');
  assert.match(r.say, /10 AM/);
  assert.equal(g.brain.hasPending(), false);
  r = await g.brain.handle('yes');
  assert.equal(g.opened.length, 0, 'a late yes does not send the dropped message');
});

test('basic mode: UPI payment needs a UPI ID, a yes, and then opens the UPI app', async () => {
  const g = makeG1();
  await g.brain.handle('save ravi number 9876543210');
  let r = await g.brain.handle('pay 500 rupees to ravi for lunch');
  assert.match(r.say, /UPI ID/);
  await g.brain.handle('save ravi upi id ravi@okaxis');
  r = await g.brain.handle('pay 500 rupees to ravi for lunch');
  assert.match(r.say, /Pay 500 rupees to ravi\?/);
  assert.equal(g.opened.length, 0);
  r = await g.brain.handle('yes');
  assert.equal(g.opened[0], 'upi://pay?pa=ravi%40okaxis&pn=ravi&am=500&cu=INR&tn=lunch');
  assert.match(r.say, /PIN/);
});

test('basic mode: timer, follow-up answer, reminders, alarms', async () => {
  const g = makeG1();
  let r = await g.brain.handle('set a timer');
  assert.match(r.say, /how long/i);
  r = await g.brain.handle('10 minutes');
  assert.match(r.say, /10 minutes, starting now/);
  assert.equal(r.card.type, 'timer');
  assert.equal(g.scheduler.list('timer')[0].at, NOW.getTime() + 600000);
  r = await g.brain.handle('how much time is left on the timer');
  assert.match(r.say, /10 minutes left/);
  r = await g.brain.handle('remind me to call the bank at 4 pm');
  assert.match(r.say, /remind you today at 4 PM/);
  r = await g.brain.handle('kal subah 6 baje alarm lagao');
  assert.match(r.say, /tomorrow at 6 AM/);
  r = await g.brain.handle('what are my reminders');
  assert.match(r.say, /call the bank today at 4 PM/);
  assert.equal(g.scheduler.list(['reminder', 'alarm']).length, 2);
  r = await g.brain.handle('cancel the timer');
  assert.equal(g.scheduler.list('timer').length, 0);
  r = await g.brain.handle('remind me to drink water at 9 am yesterday');
  assert.ok(r.say.length > 0);
});

test('basic mode: notes, lists, memory, maths', async () => {
  const g = makeG1();
  await g.brain.handle('take a note that the wifi password is on the fridge');
  let r = await g.brain.handle('read my notes');
  assert.match(r.say, /wifi password is on the fridge/);
  await g.brain.handle('add milk and eggs to my shopping list');
  await g.brain.handle('shopping list mein chawal daal do');
  r = await g.brain.handle("what's on my shopping list");
  assert.match(r.say, /milk, eggs, chawal/);
  await g.brain.handle('remove milk from my shopping list');
  assert.deepEqual(g.store.get('lists').shopping, ['eggs', 'chawal']);
  await g.brain.handle('remember that my bike number is AP02 1234');
  r = await g.brain.handle('what do you remember about me');
  assert.match(r.say, /bike number/);
  r = await g.brain.handle('what is 15 percent of 2400');
  assert.match(r.say, /360/);
});

test('basic mode: weather speaks the forecast, and says so when it is offline', async () => {
  const g = makeG1({ routes: WEATHER_ROUTES });
  let r = await g.brain.handle("what's the weather in hyderabad");
  assert.match(r.say, /28 degrees and partly cloudy in Hyderabad\. High of 31/);
  assert.deepEqual(r.card, { type: 'weather', place: 'Hyderabad', temp: 28, summary: 'partly cloudy', hi: 31, lo: 20, rain: 10 });
  r = await g.brain.handle('will it rain tomorrow in hyderabad');
  assert.match(r.say, /Tomorrow in Hyderabad: rain, 20 to 28 degrees, 70 percent chance of rain/);
  const offline = makeG1();
  r = await offline.brain.handle("what's the weather in hyderabad");
  assert.match(r.say, /can't reach the weather service/);
});

test('basic mode: Hinglish replies when the language is Hindi', async () => {
  const g = makeG1({ settings: { language: 'hi-IN' }, routes: WEATHER_ROUTES });
  let r = await g.brain.handle('10 minute ka timer lagao');
  assert.equal(r.say, '10 minute ka timer shuru.');
  r = await g.brain.handle('hyderabad mein mausam kaisa hai');
  assert.match(r.say, /Hyderabad mein abhi 28 degree hai, thode badal/);
  r = await g.brain.handle('ravi ko call karo');
  assert.match(r.say, /saved nahi hai/);
});

test('basic mode: maps, music, travel, feeds, torch, battery, voice change', async () => {
  const g = makeG1();
  await g.brain.handle('navigate to anantapur bus stand');
  assert.equal(g.opened.at(-1), 'https://www.google.com/maps/dir/?api=1&destination=anantapur%20bus%20stand&travelmode=driving');
  await g.brain.handle('find a petrol pump near me');
  assert.match(g.opened.at(-1), /maps\/search\/\?api=1&query=petrol%20pump%20near%20me/);
  await g.brain.handle('play arijit singh on spotify');
  assert.equal(g.opened.at(-1), 'https://open.spotify.com/search/arijit%20singh');
  await g.brain.handle('book a train from anantapur to bangalore tomorrow');
  assert.match(g.opened.at(-1), /train%20from%20anantapur%20to%20bangalore%20on%202026-11-11/);
  const before = g.opened.length;
  let r = await g.brain.handle('open instagram');
  assert.match(r.say, /Scrolling feeds isn't my thing/);
  assert.equal(g.opened.length, before, 'feeds are never opened');
  r = await g.brain.handle('how much battery is left');
  assert.match(r.say, /72 percent/);
  r = await g.brain.handle('change your voice');
  assert.equal(g.settings.get().tts.preset, 'shlok');
  r = await g.brain.handle('look at this');
  assert.match(r.say, /need an AI key/);
});

test('basic mode: things it cannot parse get an honest answer, and stop is silent', async () => {
  const g = makeG1();
  let r = await g.brain.handle('i had a long day and i am tired');
  assert.equal(r.understood, false);
  r = await g.brain.handle('stop');
  assert.equal(r.stop, true);
  assert.equal(r.say, '');
});

test('AI mode: the model calls tools, gets results back, and its words are spoken', async () => {
  const llm = scriptedLLM([{ calls: [{ name: 'get_weather', args: { place: 'Hyderabad' } }] }, { text: "It's **28 degrees** and a bit cloudy in Hyderabad. 🌤️" }]);
  const g = makeG1({ llm, routes: WEATHER_ROUTES, settings: { userName: 'Jashwanth' } });
  const r = await g.brain.handle('Hyderabad lo weather ela undi?');
  assert.equal(r.say, "It's 28 degrees and a bit cloudy in Hyderabad.");
  assert.equal(r.card.type, 'weather');
  assert.equal(r.source, 'ai');
  // first request: system prompt, tools, user turn
  assert.match(llm.seen[0].system, /You are G1/);
  assert.match(llm.seen[0].system, /Jashwanth/);
  assert.ok(llm.seen[0].tools.length >= 35);
  assert.equal(llm.seen[0].messages.at(-1).content, 'Hyderabad lo weather ela undi?');
  // second request carries the assistant tool call untouched and the tool result
  const [, second] = llm.seen;
  const call = second.messages.at(-2);
  const result = second.messages.at(-1);
  assert.equal(call.tool_calls[0].extra_content.google.thought_signature, 'sig');
  assert.equal(result.role, 'tool');
  assert.equal(result.tool_call_id, call.tool_calls[0].id);
  assert.equal(JSON.parse(result.content).temperature_c, 28);
});

test('AI mode: messages still wait for the user to say yes', async () => {
  const llm = scriptedLLM([{ calls: [{ name: 'send_message', args: { to: 'Ravi', text: 'Running 10 minutes late', channel: 'whatsapp' } }] }, { text: 'should not be reached' }]);
  const g = makeG1({ llm });
  g.store.set('contacts', [{ id: '1', name: 'Ravi', phone: '9876543210', aliases: [] }]);
  let r = await g.brain.handle('tell ravi i am running ten minutes late');
  assert.match(r.say, /WhatsApp to Ravi: "Running 10 minutes late"\. Send it\?/);
  assert.equal(r.expectReply, true);
  assert.equal(g.opened.length, 0);
  assert.equal(llm.seen.length, 1, 'the model is not asked again while waiting');
  r = await g.brain.handle('yes send it');
  assert.equal(g.opened[0], 'https://wa.me/919876543210?text=Running%2010%20minutes%20late');
  // history stays well-formed for the next model turn
  const roles = g.brain.history().map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant', 'user', 'assistant']);
});

test('AI mode: if the AI service fails, G1 falls back to basic mode and says so only when it must', async () => {
  const llm = scriptedLLM([{ error: 'The AI key was rejected.' }]);
  const g = makeG1({ llm });
  let r = await g.brain.handle('set a timer for 5 minutes');
  assert.match(r.say, /5 minutes, starting now/);
  assert.equal(r.notice, 'The AI key was rejected.');
  r = await g.brain.handle('tell me something interesting about space');
  assert.match(r.say, /can't reach my AI brain/);
});

test('AI mode: camera questions go to the vision model', async () => {
  const llm = scriptedLLM([{ calls: [{ name: 'look', args: { question: 'what is this' } }] }, { text: "That's a steel water bottle." }]);
  const g = makeG1({ llm });
  const r = await g.brain.handle('ye kya hai');
  assert.equal(r.say, "That's a steel water bottle.");
  assert.equal(r.card.type, 'photo');
});

test('LLM client: request shape, tool-call parsing, error messages', async () => {
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const llm = createLLM({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    headers: { Authorization: 'Bearer KEY' },
    model: 'gemini-3.8-flash',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return ok({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] } }] });
    },
  });
  const r = await llm.chat({ system: 'SYS', messages: [{ role: 'user', content: 'time?' }], tools: [{ type: 'function', function: { name: 'get_time', parameters: { type: 'object', properties: {} } } }] });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer KEY');
  assert.equal(sent.model, 'gemini-3.8-flash');
  assert.deepEqual(sent.messages[0], { role: 'system', content: 'SYS' });
  assert.equal(sent.tool_choice, 'auto');
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'get_time', args: {} }]);
  assert.equal(r.message.content, '');

  const bad = createLLM({ url: 'x', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'API key not valid' } }) }) });
  await assert.rejects(() => bad.chat({ messages: [] }), /key was rejected.*API key not valid/);
  const down = createLLM({ url: 'x', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => down.chat({ messages: [] }), /Could not reach the AI service/);
});

test('persona: prompt carries time, language and memory; speech text is cleaned', () => {
  const p = buildSystemPrompt({ settings: { language: 'hi-IN', userName: 'Jashwanth', homeCity: 'Anantapur' }, memory: ['Prefers tea'], now: NOW, timeZone: 'Asia/Kolkata' });
  assert.match(p, /10 AM, Tuesday, 10 November 2026 \(Asia\/Kolkata\)\. ISO: 2026-11-10T10:00:00/);
  assert.match(p, /Hinglish/);
  assert.match(p, /Prefers tea/);
  assert.equal(forSpeech('**Done!** See [this](https://x.y) 😀\n- one\n- two'), 'Done! See this one two');
});

test('phone numbers get the country code the links need', () => {
  assert.equal(intlNumber('98765 43210'), '919876543210');
  assert.equal(intlNumber('+1 415 555 0100'), '14155550100');
  assert.equal(intlNumber('09876543210'), '919876543210');
});

test('scheduler: items persist, fire once, and report how late they are', () => {
  const mem = new Map();
  const store = createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) });
  let clock = 1000;
  const pendingTimers = [];
  const fired = [];
  const make = () => createScheduler({ store, onFire: (x) => fired.push(x), now: () => clock, setTimer: (fn, ms) => pendingTimers.push({ fn, ms }), clearTimer: () => {} });
  const a = make();
  a.add({ kind: 'reminder', at: 61000, text: 'tea' });
  assert.equal(pendingTimers[0].ms, 60000);
  // "reload": a new scheduler over the same storage, later in time
  clock = 90000;
  const b = make();
  b.resume();
  assert.equal(pendingTimers.at(-1).ms, 0, 'a missed reminder fires straight away');
  pendingTimers.at(-1).fn();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].text, 'tea');
  assert.equal(fired[0].lateBy, 29000);
  assert.equal(b.list().length, 0);
  pendingTimers[0].fn();
  assert.equal(fired.length, 1, 'never fires twice');
});

function fakeCore(features = {}) {
  const calls = [];
  return {
    calls,
    available: () => true,
    can: (f) => Boolean(features[f]),
    async run(name, args, approved = false) {
      calls.push({ name, args, approved });
      if (name === 'create_video') return { ok: true, video_id: 'g1_abc', file: '/media/g1_abc.mp4', scenes: args.scenes.length };
      if (name === 'post_video') return features.youtube ? { ok: true, url: 'https://youtube.com/shorts/xyz', visibility: args.visibility } : { ok: false, error: 'YouTube not connected yet (set YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)' };
      if (name === 'send_sms') return { ok: true, route: 'sim', to: args.to };
      if (name === 'send_whatsapp') return { ok: true, route: 'cloud_api', to: args.to };
      return { ok: false, error: 'unknown' };
    },
  };
}

test('G1 Core: make a video, then posting waits for a yes', async () => {
  const core = fakeCore({ youtube: true });
  const g = makeG1({ core });
  let r = await g.brain.handle('make a video about morning habits');
  assert.match(r.say, /video is ready, 4 scenes/);
  assert.deepEqual(r.card, { type: 'video', src: '/media/g1_abc.mp4', title: 'morning habits' });
  assert.equal(core.calls[0].args.scenes.length, 4);
  r = await g.brain.handle('post it');
  assert.match(r.say, /Post "morning habits" to YouTube as private\?/);
  assert.equal(core.calls.length, 1, 'nothing is posted before the yes');
  r = await g.brain.handle('yes');
  assert.deepEqual(core.calls[1], { name: 'post_video', args: { video_id: 'g1_abc', caption: 'morning habits', visibility: 'private' }, approved: true });
  assert.match(r.say, /Posted as private/);
  assert.equal(r.card.url, 'https://youtube.com/shorts/xyz');
});

test('G1 Core: honest answers when Core or YouTube is missing', async () => {
  let g = makeG1();
  let r = await g.brain.handle('make a video about chai');
  assert.match(r.say, /needs G1 Core/);
  r = await g.brain.handle('post it');
  assert.match(r.say, /no video yet/);
  g = makeG1({ core: fakeCore() });
  await g.brain.handle('make a video about chai');
  await g.brain.handle('post it');
  r = await g.brain.handle('haan');
  assert.match(r.say, /YouTube is not connected yet/);
});

test('G1 Core: with a SIM or business number the message is sent with no tap', async () => {
  const core = fakeCore({ sim: true, whatsapp_api: true });
  const g = makeG1({ core });
  await g.brain.handle('save amma number 9000000001');
  await g.brain.handle('text amma that the train is late');
  let r = await g.brain.handle('yes');
  assert.equal(r.say, 'Sent.');
  assert.deepEqual(core.calls[0], { name: 'send_sms', args: { to: '919000000001', message: 'the train is late' }, approved: true });
  await g.brain.handle('tell amma that i reached');
  r = await g.brain.handle('yes');
  assert.equal(r.say, 'Sent.');
  assert.equal(core.calls[1].name, 'send_whatsapp');
  assert.equal(g.opened.length, 0, 'no app had to be opened');
});

test('hotels with dates open real availability for those nights', async () => {
  const g = makeG1();
  await g.brain.handle('find a hotel in goa for 2 nights tomorrow');
  assert.equal(g.opened.at(-1), 'https://www.booking.com/searchresults.html?ss=goa&checkin=2026-11-11&checkout=2026-11-13&group_adults=2&no_rooms=1');
});
