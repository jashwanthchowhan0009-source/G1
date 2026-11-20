// Live call in real Chrome against a fake Gemini Live server: connects, streams the mic, plays G1's
// voice, stops on interruption, runs tools, and only does a payment after the user says "haan".
//   node tests/browser/live.mjs

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from '../../server.mjs';

const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const server = createServer({});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

// A fake Gemini Live server living inside the page (replaces WebSocket).
const fakeGemini = () => {
  window.__live = { sent: [], audioChunks: 0, socket: null };
  window.__opened = [];
  // upi:/tel: links would navigate the test page away; record them like the Android app's bridge does
  window.G1Native = { open: (url) => (/^https?:/.test(url) ? null : (window.__opened.push(url), 'opened')) };
  window.open = (url) => (window.__opened.push(url), {});
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      window.__live.socket = this;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 10);
    }
    send(raw) {
      const m = JSON.parse(raw);
      if (m.realtimeInput) window.__live.audioChunks++;
      else window.__live.sent.push(m);
      if (m.setup) setTimeout(() => this.push({ setupComplete: {} }), 10);
    }
    push(m) {
      this.onmessage?.({ data: JSON.stringify(m) });
    }
    close() {
      this.readyState = 3;
    }
  }
  window.WebSocket = FakeSocket;
};

const page = await (await browser.newContext()).newPage();
// poll on a timer: animation-frame polling stalls in headless Chrome while audio is playing
const waitFor = (fn, arg, opts) => page.waitForFunction(fn, arg ?? null, { polling: 100, timeout: 10000, ...(opts || {}) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(fakeGemini);
// the server says: AI and Gemini voice are on, so live calling is available
await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, llm: true, tts: true, ttsEngine: 'gemini', search: false } }));
await page.route('**/api/live', async (r) => {
  const body = JSON.parse(r.request().postData() || '{}');
  if (body.ok) return r.fulfill({ json: { ok: true } });
  return r.fulfill({ json: { token: 'auth_tokens/test', model: 'gemini-3.8-live', version: 'v1beta', ws: 'wss://fake/live' } });
});
await page.goto(base);
await page.evaluate(() => {
  localStorage.setItem('g1:started', 'true');
  localStorage.setItem('g1:contacts', JSON.stringify([{ id: 'c1', name: 'Papa', phone: '+919800000001', upi: 'papa@upi' }]));
});
await page.reload();
await waitFor(() => document.documentElement.dataset.ready === 'true');
if (await page.isVisible('#start')) await page.click('#start button, #start [data-start], #startBtn').catch(() => {});

// 1. Tap the mic: a live call starts, setup carries G1's tools, and the mic streams audio
await page.click('#mic');
await waitFor(() => window.__live.sent.some((m) => m.setup));
const setup = await page.evaluate(() => window.__live.sent.find((m) => m.setup).setup);
assert.equal(setup.model, 'models/gemini-3.8-live');
assert.equal(setup.generationConfig.responseModalities[0], 'AUDIO');
const names = setup.tools[0].functionDeclarations.map((d) => d.name);
for (const n of ['call_contact', 'send_upi_payment', 'play_media', 'end_conversation']) assert.ok(names.includes(n) || names.some((x) => x.startsWith(n.split('_')[0])), `tool ${n} missing: ${names.join(',')}`);
assert.match(setup.systemInstruction.parts[0].text, /live voice call/);
await waitFor(() => window.__live.audioChunks > 3, null, { timeout: 5000 });
await waitFor(() => document.getElementById('mic').classList.contains('live'));
console.log('live: connected, tools sent, mic streaming');

// 2. G1 speaks (24 kHz PCM), then the user cuts in: playback stops
await page.evaluate(() => {
  const pcm = new Int16Array(24000).map((_, i) => Math.sin(i / 8) * 8000); // 1 second
  let s = '';
  new Uint8Array(pcm.buffer).forEach((b) => (s += String.fromCharCode(b)));
  window.__live.socket.push({ serverContent: { outputTranscription: { text: 'Haan bolo!' }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: btoa(s) } }] } } });
});
await waitFor(() => document.getElementById('screen').dataset.state === 'speaking');
assert.equal(await page.textContent('#said'), 'Haan bolo!');
await page.evaluate(() => window.__live.socket.push({ serverContent: { interrupted: true } }));
await waitFor(() => document.getElementById('screen').dataset.state === 'listening');
console.log('live: G1 speaks, and stops when interrupted');

// 3. A payment: the AI asks for it, the device holds it until the user says haan
const payTool = names.find((n) => /upi|pay/.test(n));
await page.evaluate((name) => {
  window.__live.socket.push({ serverContent: { inputTranscription: { text: 'Papa ko 500 bhejo' } } });
  window.__live.socket.push({ toolCall: { functionCalls: [{ id: 'f1', name, args: { to: 'Papa', amount: 500 } }] } });
}, payTool);
await waitFor(() => window.__live.sent.some((m) => m.toolResponse));
const waiting = await page.evaluate(() => window.__live.sent.find((m) => m.toolResponse).toolResponse.functionResponses[0].response);
assert.equal(waiting.status, 'waiting_for_user_yes_or_no', JSON.stringify(waiting));
assert.equal(await page.evaluate(() => window.__opened.length), 0, 'nothing paid before yes');
// the AI itself claiming "done" changes nothing; only the user's words count
await page.evaluate(() => window.__live.socket.push({ serverContent: { outputTranscription: { text: 'Bhej diya!' } } }));
assert.equal(await page.evaluate(() => window.__opened.length), 0, 'the AI cannot approve a payment');
await page.evaluate(() => {
  window.__live.socket.push({ serverContent: { turnComplete: true } });
  window.__live.socket.push({ serverContent: { inputTranscription: { text: 'haan' } } });
});
await waitFor(() => window.__live.sent.some((m) => m.clientContent));
const note = await page.evaluate(() => window.__live.sent.find((m) => m.clientContent).clientContent.turns[0].parts[0].text);
assert.match(note, /^\[device\] The user said yes/);
const opened = await page.evaluate(() => window.__opened);
assert.ok(opened.some((u) => /^upi:\/\/pay.*papa(%40|@)upi.*am=500/.test(u)), `UPI opened: ${opened}`);
console.log('live: payment only after the user said haan');

// 4. "no" cancels
await page.evaluate((name) => window.__live.socket.push({ toolCall: { functionCalls: [{ id: 'f2', name, args: { to: 'Papa', amount: 900 } }] } }), payTool);
await waitFor(() => window.__live.sent.filter((m) => m.toolResponse).length === 2);
await page.evaluate(() => window.__live.socket.push({ serverContent: { inputTranscription: { text: 'nahi rehne do' } } }));
await waitFor(() => window.__live.sent.filter((m) => m.clientContent).length === 2);
assert.match(await page.evaluate(() => window.__live.sent.filter((m) => m.clientContent)[1].clientContent.turns[0].parts[0].text), /said no/);
assert.equal(await page.evaluate(() => window.__opened.filter((u) => /am=900/.test(u)).length), 0);
console.log('live: "nahi" cancels');

// 5. Tap the mic again: hang up
await page.click('#mic');
await waitFor(() => !document.getElementById('mic').classList.contains('live') && document.getElementById('screen').dataset.state === 'idle');
console.log('live: hang up');

assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log('live call browser test passed');
