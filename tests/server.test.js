import test from 'node:test';
import assert from 'node:assert/strict';
import { health, chat, tts } from '../server/handlers.js';

const ENV = { LLM_API_KEY: 'k', ELEVENLABS_API_KEY: 'e' };
const post = (path, body, headers = {}) => new Request('http://x' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const upstreamOk = (calls) => async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
};

test('health reports what is configured, and ?test=1 makes one AI call', async () => {
  assert.deepEqual(await (await health(new Request('http://x/api/health'), {})).json(), { ok: true, llm: false, tts: false, locked: false, model: 'gemini-3.5-flash' });
  const calls = [];
  const j = await (await health(new Request('http://x/api/health?test=1'), ENV, upstreamOk(calls))).json();
  assert.equal(j.test.status, 200);
  assert.equal(j.test.reply, 'ok');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.ok(!JSON.stringify(j).includes('"k"'), 'the key is never echoed');
});

test('chat forwards messages and tools, keeps the key server-side, and passes errors through', async () => {
  const calls = [];
  const tools = [{ type: 'function', function: { name: 'get_time', parameters: { type: 'object', properties: {} } } }];
  const res = await chat(post('/api/llm', { messages: [{ role: 'user', content: 'hi' }], tools }), ENV, upstreamOk(calls));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'ok');
  assert.equal(calls[0].body.model, 'gemini-3.5-flash');
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.tool_choice, 'auto');
  // a non-Gemini service is not sent Gemini-only options
  await chat(post('/api/llm', { messages: [] }), { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.groq.com/openai/v1', LLM_MODEL: 'llama-3.3-70b-versatile' }, upstreamOk(calls));
  assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal('reasoning_effort' in calls[1].body, false);
  const bad = await chat(post('/api/llm', { messages: [] }), ENV, async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /not valid/);
});

test('chat gives clear answers for slow or missing AI, wrong passcode, wrong method', async () => {
  const slow = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  // shorten the wait by aborting ourselves: emulate the deadline firing
  const res = await chat(post('/api/llm', { messages: [] }), ENV, (url, init) => {
    const p = slow(url, init);
    setTimeout(() => init.signal.dispatchEvent(new Event('abort')), 5);
    return p;
  });
  assert.equal(res.status, 504);
  assert.equal((await chat(post('/api/llm', { messages: [] }), {})).status, 503);
  assert.equal((await chat(post('/api/llm', { messages: [] }), { ...ENV, G1_PASSCODE: 'p' })).status, 401);
  assert.equal((await chat(post('/api/llm', { messages: [] }, { 'x-g1-pass': 'p' }), { ...ENV, G1_PASSCODE: 'p' }, upstreamOk([]))).status, 200);
  assert.equal((await chat(new Request('http://x/api/llm'), ENV)).status, 405);
  assert.equal((await chat(post('/api/llm', { nope: 1 }), ENV)).status, 400);
});

test('speak validates input and returns audio', async () => {
  const audio = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  const ok = await tts(post('/api/speak', { text: 'hello', voice_id: 'iLrek0aeAREetkK9NhwJ' }), ENV, audio);
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await ok.arrayBuffer()).byteLength, 3);
  assert.equal((await tts(post('/api/speak', { text: 'hello', voice_id: '../x' }), ENV, audio)).status, 400);
  assert.equal((await tts(post('/api/speak', { text: ' ', voice_id: 'iLrek0aeAREetkK9NhwJ' }), ENV, audio)).status, 400);
});

test('when the first Gemini model is overloaded or slow, the next one answers', async () => {
  const tried = [];
  const flaky = async (url, init) => {
    const body = JSON.parse(init.body);
    tried.push(body.model);
    if (body.model === 'gemini-3.5-flash') return new Response(JSON.stringify([{ error: { message: 'high demand' } }]), { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const res = await chat(post('/api/llm', { messages: [{ role: 'user', content: 'hi' }] }), ENV, flaky);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-g1-model'), 'gemini-flash-lite-latest');
  assert.deepEqual(tried, ['gemini-3.5-flash', 'gemini-flash-lite-latest']);
  const j = await (await health(new Request('http://x/api/health?test=1'), ENV, flaky)).json();
  assert.equal(j.test.model, 'gemini-flash-lite-latest');
  // a bad key is not retried on other models
  tried.length = 0;
  const bad = await chat(post('/api/llm', { messages: [] }), ENV, async (u, init) => (tried.push(JSON.parse(init.body).model), new Response('{"error":{"message":"bad key"}}', { status: 400 })));
  assert.equal(bad.status, 400);
  assert.equal(tried.length, 1);
});
