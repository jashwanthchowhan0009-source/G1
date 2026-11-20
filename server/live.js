// Live voice (talk like a phone call): the app streams audio straight to Gemini Live.
// The server never relays audio; it only mints a short-lived, single-use token so the real API key
// never reaches the phone.

import { json, locked, geminiTtsReady } from './handlers.js';

export const LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'];
const WS = (v) => `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${v}.GenerativeService.BidiGenerateContentConstrained`;
const API = 'https://generativelanguage.googleapis.com';

// What worked last (model + API version), so the next session starts with it.
let good = { model: LIVE_MODELS[0], version: 'v1beta', until: 0 };

/** One token: starts one session within a minute, lasts at most 30 minutes. */
export async function mintToken(env, _model, version = 'v1beta', fetchImpl = fetch) {
  const now = Date.now();
  const res = await fetchImpl(`${API}/${version}/auth_tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.LLM_API_KEY },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60000).toISOString(),
      newSessionExpireTime: new Date(now + 60000).toISOString(),
      // single use, one minute to start: the REST API rejects the SDK's model-lock field, so none here
    }),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`token ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  const name = JSON.parse(text).name;
  if (!name) throw new Error('token missing');
  return name;
}

export function liveModel() {
  return Date.now() < good.until ? good : { model: LIVE_MODELS[0], version: 'v1beta' };
}

/** The app reports which model/version connected, so the next token starts there. */
export function markGood(model, version) {
  if (LIVE_MODELS.includes(model) && ['v1beta', 'v1alpha'].includes(version)) good = { model, version, until: Date.now() + 6 * 3600000 };
}

/** POST /api/live { model?, version?, ok? } -> { token, model, version, ws, models } */
export async function live(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!geminiTtsReady(env)) return json({ error: 'Live voice needs a Gemini LLM_API_KEY on the server' }, 503);
  if (locked(request, env)) return json({ error: 'Wrong or missing G1 passcode' }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  if (body.ok) {
    markGood(String(body.model || ''), String(body.version || ''));
    return json({ ok: true });
  }
  const pick = liveModel();
  const model = LIVE_MODELS.includes(body.model) ? body.model : pick.model;
  const version = ['v1beta', 'v1alpha'].includes(body.version) ? body.version : pick.version;
  try {
    const token = await mintToken(env, model, version, fetchImpl);
    return json({ token, model, version, ws: WS(version), models: LIVE_MODELS });
  } catch (e) {
    return json({ error: e.message }, e.status === 429 ? 429 : 502);
  }
}

/**
 * Health self-test: token -> WebSocket -> one spoken reply. Tries models and API versions until one
 * answers with audio. { ok, model, version, ms, audioBytes } or { ok:false, tried:[...] }.
 */
export async function liveSelfTest(env, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, declarations = null) {
  if (!WebSocketImpl) return { ok: false, error: 'no WebSocket in this runtime' };
  const tried = [];
  for (const version of ['v1beta', 'v1alpha']) {
    for (const model of LIVE_MODELS) {
      const t0 = Date.now();
      try {
        const token = await mintToken(env, model, version, fetchImpl);
        const audioBytes = await oneTurn(WebSocketImpl, `${WS(version)}?access_token=${encodeURIComponent(token)}`, model, declarations);
        markGood(model, version);
        return { ok: true, model, version, ms: Date.now() - t0, audioBytes, tools: declarations ? declarations.length : 1 };
      } catch (e) {
        tried.push(`${version}/${model}: ${String(e.message || e).slice(0, 160)}`);
      }
    }
  }
  return { ok: false, tried };
}

function oneTurn(WebSocketImpl, url, model, declarations) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    let bytes = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(bytes ? 'turn never completed' : 'no answer in 15s'));
    }, 15000);
    const done = (fn) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed */
      }
      fn();
    };
    ws.onopen = () =>
      ws.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achird' } } } },
          systemInstruction: { parts: [{ text: 'You are G1. Reply in one short sentence.' }] },
          tools: [{ functionDeclarations: declarations || [{ name: 'set_timer', description: 'Start a timer', parameters: { type: 'object', properties: { minutes: { type: 'number' } }, required: ['minutes'] } }] }],
        },
      }));
    ws.onmessage = async (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : await new Response(ev.data).text());
      } catch {
        return;
      }
      if (m.setupComplete) ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Say hello in Hinglish.' }] }], turnComplete: true } }));
      for (const p of m.serverContent?.modelTurn?.parts || []) if (p.inlineData?.data) bytes += Math.floor((p.inlineData.data.length * 3) / 4);
      if (m.serverContent?.turnComplete) done(() => (bytes ? resolve(bytes) : reject(new Error('turn had no audio'))));
    };
    ws.onerror = () => done(() => reject(new Error('socket error')));
    ws.onclose = (ev) => done(() => reject(new Error(`closed ${ev.code} ${String(ev.reason || '').slice(0, 120)}`)));
  });
}
