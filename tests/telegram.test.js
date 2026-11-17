import test from 'node:test';
import assert from 'node:assert/strict';
import { telegram, tick, webhookSecret } from '../server/telegram.js';
import { readPage, htmlToText, isoLocal } from '../server/agent.js';
import { createStore } from '../server/store.js';

const TOKEN = '123:abc';
const OWNER = 777;
const NOW = new Date('2026-11-17T12:30:00Z'); // 6 PM in India

/** A fake world: Telegram, Gemini (chat, search, audio), Redis, and web pages. */
function world(script = []) {
  const sent = [];
  const llmSeen = [];
  const redis = createStore({}); // in-memory, shared through a fake Redis endpoint
  let step = 0;
  const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    url = String(url);
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (url.startsWith('https://redis.test')) return reply({ result: await redis.cmd(...body) });
    if (url.includes('api.telegram.org/file/')) return new Response(new Uint8Array([1, 2, 3]));
    if (url.includes('api.telegram.org/bot')) {
      const method = url.split('/').pop();
      if (method === 'sendMessage') sent.push(body);
      if (method === 'getFile') return reply({ ok: true, result: { file_path: 'voice/1.oga' } });
      if (method === 'getMe') return reply({ ok: true, result: { username: 'g1_test_bot' } });
      return reply({ ok: true, result: true });
    }
    if (url.includes('/openai/chat/completions')) {
      llmSeen.push(body);
      const s = script[Math.min(step++, script.length - 1)];
      const message = { role: 'assistant', content: s.text ?? null };
      if (s.calls) message.tool_calls = s.calls.map((c, i) => ({ id: `c${step}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      return reply({ choices: [{ message }] });
    }
    if (url.includes(':generateContent')) {
      if (body.tools?.[0]?.google_search) return reply({ candidates: [{ content: { parts: [{ text: 'Hotel Sea Breeze, Calangute, ₹2,800 a night.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/seabreeze', title: 'Sea Breeze' } }] } }] });
      return reply({ candidates: [{ content: { parts: [{ text: 'kal subah 8 baje gym yaad dilana' }] } }] });
    }
    if (url.startsWith('https://shop.test/')) return new Response('<html><head><title>Phone</title><script>x()</script></head><body><h1>iPhone 16</h1><p>Price: &#8377;58,999</p></body></html>', { headers: { 'content-type': 'text/html' } });
    return reply({}, 404);
  };
  const env = { TELEGRAM_BOT_TOKEN: TOKEN, LLM_API_KEY: 'k', KV_REST_API_URL: 'https://redis.test', KV_REST_API_TOKEN: 't' };
  const hook = (message, update_id = Math.floor(Math.random() * 1e9)) =>
    new Request('https://g1.test/api/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret(TOKEN) }, body: JSON.stringify({ update_id, message: { chat: { id: message.from ?? OWNER, type: 'private' }, from: { id: message.from ?? OWNER }, ...message } }) });
  return { env, fetchImpl, sent, llmSeen, hook, redis };
}

test('setup registers the webhook with a secret, and only Telegram with that secret gets in', async () => {
  const w = world();
  const r = await (await telegram(new Request('https://g1.test/api/telegram?setup=1', { headers: { host: 'g1.test' } }), w.env, w.fetchImpl)).json();
  assert.deepEqual([r.ok, r.webhook, r.bot], [true, 'https://g1.test/api/telegram', '@g1_test_bot']);
  const forged = new Request('https://g1.test/api/telegram', { method: 'POST', body: '{}' });
  assert.equal((await telegram(forged, w.env, w.fetchImpl)).status, 403);
});

test('first user becomes the owner; strangers are turned away; retries run once', async () => {
  const w = world([{ text: 'Hi!' }]);
  await telegram(w.hook({ text: '/start' }), w.env, w.fetchImpl);
  assert.match(w.sent[0].text, /main G1 hu/);
  await telegram(w.hook({ text: 'hello', from: 999 }), w.env, w.fetchImpl);
  assert.equal(w.sent[1].text, 'Yeh G1 kisi aur ka hai.');
  assert.equal(w.llmSeen.length, 0);
  await telegram(w.hook({ text: 'hi' }, 42), w.env, w.fetchImpl);
  await telegram(w.hook({ text: 'hi' }, 42), w.env, w.fetchImpl);
  assert.equal(w.llmSeen.length, 1);
});

test('the agent searches the web, then answers with what it found', async () => {
  const w = world([{ calls: [{ name: 'web_search', args: { query: 'hotels in Goa under 3000' } }] }, { text: 'Best pick: Hotel Sea Breeze, ₹2,800\nhttps://example.com/seabreeze' }]);
  await telegram(w.hook({ text: 'Goa mein 3000 ke andar hotel dhundo' }), w.env, w.fetchImpl);
  assert.match(w.sent.at(-1).text, /Sea Breeze, ₹2,800/);
  const toolMsg = w.llmSeen[1].messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.deepEqual(JSON.parse(toolMsg.content).sources, [{ title: 'Sea Breeze', url: 'https://example.com/seabreeze' }]);
  assert.match(w.llmSeen[0].messages[0].content, /You are G1/);
});

test('voice notes are transcribed and acted on; a reminder is scheduled and later delivered', async () => {
  const w = world([{ calls: [{ name: 'schedule', args: { kind: 'remind', when: '2026-11-18T08:00:00+05:30', text: 'Gym time' } }] }, { text: 'Done, kal 8 baje yaad dila dunga.' }]);
  await telegram(w.hook({ voice: { file_id: 'v1', file_size: 2000, mime_type: 'audio/ogg' } }), w.env, w.fetchImpl);
  assert.equal(w.llmSeen[0].messages.at(-1).content, 'kal subah 8 baje gym yaad dilana');
  assert.match(w.sent.at(-1).text, /yaad dila dunga/);
  let t = await (await tick(null, w.env, w.fetchImpl, NOW)).json();
  assert.equal(t.due, 0, 'not due yet');
  t = await (await tick(null, w.env, w.fetchImpl, new Date('2026-11-18T02:35:00Z'))).json();
  assert.deepEqual([t.due, t.ran], [1, 1]);
  assert.equal(w.sent.at(-1).text, 'Reminder: Gym time');
  t = await (await tick(null, w.env, w.fetchImpl, new Date('2026-11-18T02:45:00Z'))).json();
  assert.equal(t.due, 0, 'a one-time reminder runs once');
});

test('a repeating check runs the agent, stays quiet on SKIP, and comes back next day', async () => {
  const w = world([{ calls: [{ name: 'schedule', args: { kind: 'check', when: '2026-11-18T09:00:00+05:30', text: 'Tell me if iPhone 16 is under 60000', repeat: 'daily' } }] }, { text: 'Roz 9 baje check karunga.' }, { text: 'SKIP' }]);
  await telegram(w.hook({ text: 'iPhone 16 60000 se neeche aaye toh batana' }), w.env, w.fetchImpl);
  const before = w.sent.length;
  const t = await (await tick(null, w.env, w.fetchImpl, new Date('2026-11-18T03:31:00Z'))).json();
  assert.equal(t.ran, 1);
  assert.equal(w.sent.length, before, 'SKIP sends nothing');
  assert.match(w.llmSeen.at(-1).messages[0].content, /reply with exactly: SKIP/);
  const due = await w.redis.cmd('ZRANGEBYSCORE', 'g1:tasks', '-inf', '+inf');
  assert.equal(due.length, 1, 'rescheduled for tomorrow');
});

test('memory carries across messages', async () => {
  const w = world([{ calls: [{ name: 'remember', args: { fact: 'Lives in Anantapur' } }] }, { text: 'Noted.' }, { text: 'Anantapur.' }]);
  await telegram(w.hook({ text: 'yaad rakhna main Anantapur mein rehta hu' }), w.env, w.fetchImpl);
  await telegram(w.hook({ text: 'main kahan rehta hu?' }), w.env, w.fetchImpl);
  const sys = w.llmSeen.at(-1).messages[0].content;
  assert.match(sys, /- Lives in Anantapur/);
  assert.equal(w.llmSeen.at(-1).messages.filter((m) => m.role === 'user').length, 2, 'earlier turn is in the history');
});

test('pages are read as text; private addresses are refused', async () => {
  const w = world();
  const r = await readPage(w.fetchImpl, 'https://shop.test/iphone');
  assert.equal(r.text, 'Phone\niPhone 16\nPrice: ₹58,999');
  for (const bad of ['http://localhost:3000', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://10.0.0.5/'])
    assert.equal((await readPage(w.fetchImpl, bad)).ok, false, bad);
  assert.equal(htmlToText('<p>a&nbsp;b</p><style>x</style>'), 'a b');
  assert.equal(isoLocal(NOW, 'Asia/Kolkata'), '2026-11-17T18:00:00+05:30');
});

test('when Google grounding is not available, search falls back to plain web results', async () => {
  const html = '<div class="result results_links"><div class="result__body"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fgoa&amp;rut=x">Goa <b>hotels</b> under 3000</a><a class="result__snippet" href="x">Rooms from &#8377;2,500</a></div></div>';
  const fetchImpl = async (url) => {
    if (String(url).includes(':generateContent')) return new Response('{"error":{"message":"quota"}}', { status: 429 });
    if (String(url).includes('duckduckgo')) return new Response(html, { headers: { 'content-type': 'text/html' } });
    return new Response('{}', { status: 404 });
  };
  const { webSearch } = await import('../server/agent.js');
  const r = await webSearch({ LLM_API_KEY: 'k' }, fetchImpl, 'goa hotels');
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, [{ url: 'https://www.example.com/goa', title: 'Goa hotels under 3000', snippet: 'Rooms from ₹2,500' }]);
});
