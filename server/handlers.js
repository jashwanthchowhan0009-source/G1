import { createStore } from './store.js';
import { webSearch, readPage } from './agent.js';
// Server side of G1 (optional). Keeps the AI and voice keys off the device.
// Used by the Vercel functions in /api and by the local dev server.
//
// Environment variables:
//   LLM_API_KEY          key for the AI service (Gemini, Groq, or any OpenAI-compatible one)
//   LLM_BASE_URL         default: Gemini's OpenAI-compatible endpoint
//   LLM_MODEL            default: gemini-3.8-flash
//   ELEVENLABS_API_KEY   key for the human-sounding voice
//   G1_PASSCODE          optional. If set, devices must send the same passcode (set it in G1's settings)

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MAX_BODY = 6 * 1024 * 1024; // room for one camera photo
const MAX_SPEECH_CHARS = 1200;

const UPSTREAM_TIMEOUT_MS = 25000;

/** fetch with a deadline, so a slow AI service gives a clear error instead of a hung request. */
export async function timedFetch(fetchImpl, url, init, ms = UPSTREAM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const text = await res.text(); // read fully inside the deadline
    return { status: res.status, type: res.headers.get('content-type') || 'application/json', text };
  } finally {
    clearTimeout(timer);
  }
}

// When Google's newest model is overloaded or slow, G1 moves on to the next one instead of failing.
const GEMINI_FALLBACKS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3.5-flash'];
const ATTEMPT_MS = 8000;
const lastGood = { model: '', until: 0 }; // per warm server instance

/** One chat completion, trying fallback models on overload, rate limit or timeout. Returns { status, type, text, model }. */
export async function askLLM(env, payload, fetchImpl) {
  const t = llmTarget(env);
  const first = env.LLM_MODEL || payload.model || t.model;
  let models = t.isGemini ? [first, ...GEMINI_FALLBACKS.filter((m) => m !== first)].slice(0, 3) : [first];
  // try the model that answered last first, so a busy one does not cost seconds on every message
  if (t.isGemini && lastGood.model && lastGood.base === t.base && Date.now() < lastGood.until) models = [lastGood.model, ...models.filter((m) => m !== lastGood.model)];
  let last = null;
  for (const model of models) {
    try {
      const r = await timedFetch(
        fetchImpl,
        t.base + '/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LLM_API_KEY },
          body: JSON.stringify({ ...payload, model, ...(t.isGemini ? { reasoning_effort: 'low' } : {}) }),
        },
        models.length > 1 ? ATTEMPT_MS : UPSTREAM_TIMEOUT_MS,
      );
      last = { ...r, model };
      if (r.status !== 429 && r.status < 500) {
        if (r.status < 300 && t.isGemini) Object.assign(lastGood, { model, base: t.base, until: Date.now() + 15 * 60000 });
        return last; // success, or an error another model will not fix
      }
      if (lastGood.model === model) lastGood.until = 0;
      console.error('AI model busy', model, r.status, r.text.slice(0, 160));
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
      console.error('AI model slow', model);
      last = last || { status: 504, type: 'application/json', text: JSON.stringify({ error: { message: 'The AI service did not answer in time' } }), model };
    }
  }
  return last;
}

export function llmTarget(env) {
  const base = (env.LLM_BASE_URL || GEMINI).replace(/\/+$/, '');
  return { base, isGemini: /generativelanguage\.googleapis\.com/.test(base), model: env.LLM_MODEL || 'gemini-flash-lite-latest' };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function locked(request, env) {
  return Boolean(env.G1_PASSCODE) && request.headers.get('x-g1-pass') !== env.G1_PASSCODE;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('Body must be JSON'), { status: 400 });
  }
}

export async function health(request, env, fetchImpl = fetch) {
  const info = { ok: true, llm: Boolean(env.LLM_API_KEY), tts: Boolean(ttsEngine(env)), ttsEngine: ttsEngine(env), locked: Boolean(env.G1_PASSCODE), model: env.LLM_MODEL || 'gemini-flash-lite-latest', telegram: Boolean(env.TELEGRAM_BOT_TOKEN), search: Boolean(env.TAVILY_API_KEY || env.LLM_API_KEY), storage: createStore(env, fetchImpl).kind };
  // /api/health?search=1 runs one live web search through the agent's search tool.
  if (new URL(request.url).searchParams.get('search') && env.LLM_API_KEY && !locked(request, env)) {
    const started = Date.now();
    const r = await webSearch(env, fetchImpl, 'Weather in Anantapur today');
    info.search = { ok: r.ok, ms: Date.now() - started, sources: r.sources?.length || 0, answer: (r.answer || '').slice(0, 120), error: r.error, detail: r.detail, via: r.via, first: r.results?.[0]?.title };
  }
  // /api/health?test=1 makes one tiny AI call and reports how it went (never the key).
  if (new URL(request.url).searchParams.get('test') && env.LLM_API_KEY && !locked(request, env)) {
    const started = Date.now();
    try {
      const r = await askLLM(env, { messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }, fetchImpl);
      let reply = '';
      let error = '';
      try {
        let j = JSON.parse(r.text);
        if (Array.isArray(j)) j = j[0];
        reply = j?.choices?.[0]?.message?.content || '';
        error = j?.error?.message || '';
      } catch {
        error = r.text.slice(0, 200);
      }
      info.test = { status: r.status, ms: Date.now() - started, model: r.model, reply: String(reply).slice(0, 60), error: String(error).slice(0, 300) };
    } catch {
      info.test = { status: 0, ms: Date.now() - started, error: 'could not reach the AI service' };
    }
  }
  // /api/health?models=1 lists the model names this key can use.
  if (new URL(request.url).searchParams.get('speak') && geminiTtsReady(env) && !locked(request, env)) {
    const t0 = Date.now();
    try {
      const { wav, model } = await geminiSpeak(env, 'Haan bolo, main sun raha hoon.', 'Achird', fetchImpl);
      info.speak = { ok: true, ms: Date.now() - t0, model, seconds: Math.round(((wav.length - 44) / 48000) * 10) / 10 };
    } catch (e) {
      info.speak = { ok: false, ms: Date.now() - t0, error: e.message };
    }
  }
  if (new URL(request.url).searchParams.get('models') && env.LLM_API_KEY && !locked(request, env)) {
    try {
      const r = await timedFetch(fetchImpl, llmTarget(env).base + '/models', { headers: { Authorization: 'Bearer ' + env.LLM_API_KEY } }, 10000);
      info.models = (JSON.parse(r.text).data || []).map((m) => String(m.id).replace(/^models\//, ''));
    } catch {
      info.models = [];
    }
  }
  return json(info);
}

export async function chat(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!env.LLM_API_KEY) return json({ error: 'LLM_API_KEY is not set on the server' }, 503);
  if (locked(request, env)) return json({ error: 'Wrong or missing G1 passcode' }, 401);
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
  if (!Array.isArray(body.messages)) return json({ error: 'messages is required' }, 400);
  const upstream = { messages: body.messages, temperature: typeof body.temperature === 'number' ? body.temperature : 0.6 };
  if (body.model) upstream.model = body.model;
  if (Array.isArray(body.tools) && body.tools.length) {
    upstream.tools = body.tools;
    upstream.tool_choice = body.tool_choice || 'auto';
  }
  let r;
  try {
    r = await askLLM(env, upstream, fetchImpl);
  } catch {
    return json({ error: 'Could not reach the AI service' }, 502);
  }
  if (r.status >= 400) console.error('AI service error', r.status, r.text.slice(0, 300));
  return new Response(r.text, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store', 'x-g1-model': r.model } });
}

// ---------------------------------------------------------------- natural voice
// ElevenLabs when its key is set; otherwise Gemini's speech models with the same AI key (no extra signup).
const GEMINI_TTS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
const GEMINI_VOICES = new Set(['Achird', 'Umbriel', 'Sulafat', 'Aoede', 'Callirrhoe', 'Puck', 'Charon', 'Kore', 'Leda', 'Zephyr', 'Orus', 'Algieba', 'Despina', 'Vindemiatrix']);
let ttsGood = { model: '', until: 0 };

export const geminiTtsReady = (env) => Boolean(env.LLM_API_KEY) && (!env.LLM_BASE_URL || /generativelanguage\.googleapis\.com/.test(env.LLM_BASE_URL));
export const ttsEngine = (env) => (env.ELEVENLABS_API_KEY ? 'elevenlabs' : geminiTtsReady(env) ? 'gemini' : '');

/** 16-bit mono PCM (what Gemini returns) wrapped as a .wav any phone can play. */
export function pcmToWav(pcm, rate = 24000) {
  const head = new DataView(new ArrayBuffer(44));
  const w = (o, str) => [...str].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  head.setUint32(4, 36 + pcm.length, true);
  w(8, 'WAVEfmt ');
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  w(36, 'data');
  head.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(head.buffer), 0);
  out.set(pcm, 44);
  return out;
}

/** Text -> { wav, model } with Gemini speech, trying the fastest model that answers. */
export async function geminiSpeak(env, text, voice, fetchImpl = fetch) {
  const name = GEMINI_VOICES.has(voice) ? voice : 'Achird';
  const order = Date.now() < ttsGood.until ? [ttsGood.model, ...GEMINI_TTS.filter((m) => m !== ttsGood.model)] : GEMINI_TTS;
  let last = { status: 502, error: 'no voice model answered' };
  for (const model of order) {
    let res;
    try {
      res = await timedFetch(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.LLM_API_KEY },
        body: JSON.stringify({
          // plain text only: a style line in front gets read out loud by these models (measured: 7.8 s vs 2.1 s)
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } } },
        }),
      }, 9000);
    } catch {
      last = { status: 504, error: `${model} timed out` };
      continue;
    }
    if (res.status < 200 || res.status > 299) {
      last = { status: res.status, error: `${model} answered ${res.status}` };
      continue;
    }
    try {
      const j = JSON.parse(res.text);
      const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('no audio');
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
      const pcm = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
      ttsGood = { model, until: Date.now() + 15 * 60000 };
      return { wav: pcmToWav(pcm, rate), model };
    } catch {
      last = { status: 502, error: `${model} sent no audio` };
    }
  }
  throw Object.assign(new Error(last.error), { status: last.status });
}

export async function tts(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!ttsEngine(env)) return json({ error: 'No voice service: set ELEVENLABS_API_KEY or a Gemini LLM_API_KEY' }, 503);
  if (locked(request, env)) return json({ error: 'Wrong or missing G1 passcode' }, 401);
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
  const text = String(body.text || '').slice(0, MAX_SPEECH_CHARS);
  const voice = String(body.voice_id || '');
  if (!text.trim()) return json({ error: 'text is required' }, 400);
  if (!env.ELEVENLABS_API_KEY) {
    try {
      const { wav, model } = await geminiSpeak(env, text, String(body.gemini_voice || ''), fetchImpl);
      return new Response(wav, { status: 200, headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'x-g1-voice': model } });
    } catch (e) {
      return json({ error: e.message }, e.status === 429 ? 429 : 502);
    }
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(voice)) return json({ error: 'voice_id is invalid' }, 400);
  let res;
  try {
    res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ text, model_id: body.model_id || 'eleven_flash_v2_5' }),
    });
  } catch {
    return json({ error: 'Could not reach the voice service' }, 502);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify((await res.json()).detail || '').slice(0, 300);
    } catch {
      /* no body */
    }
    return json({ error: `Voice service answered ${res.status}`, detail }, res.status);
  }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}

/** POST { query } -> live web results for the G1 app. */
export async function search(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (locked(request, env)) return json({ error: 'Wrong or missing G1 passcode' }, 401);
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
  const query = String(body.query || '').trim().slice(0, 300);
  if (!query) return json({ error: 'query is required' }, 400);
  return json(await webSearch(env, fetchImpl, query, env.G1_TIMEZONE || 'Asia/Kolkata'));
}

/** POST { url } -> the page as plain text. */
export async function read(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (locked(request, env)) return json({ error: 'Wrong or missing G1 passcode' }, 401);
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
  return json(await readPage(fetchImpl, String(body.url || '')));
}
