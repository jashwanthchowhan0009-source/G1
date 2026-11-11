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

export function health(_request, env) {
  return json({ ok: true, llm: Boolean(env.LLM_API_KEY), tts: Boolean(env.ELEVENLABS_API_KEY), locked: Boolean(env.G1_PASSCODE), model: env.LLM_MODEL || 'gemini-3.8-flash' });
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
  const upstream = {
    model: env.LLM_MODEL || body.model || 'gemini-3.8-flash',
    messages: body.messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
  };
  if (Array.isArray(body.tools) && body.tools.length) {
    upstream.tools = body.tools;
    upstream.tool_choice = body.tool_choice || 'auto';
  }
  const base = (env.LLM_BASE_URL || GEMINI).replace(/\/+$/, '');
  let res;
  try {
    res = await fetchImpl(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LLM_API_KEY },
      body: JSON.stringify(upstream),
    });
  } catch {
    return json({ error: 'Could not reach the AI service' }, 502);
  }
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' } });
}

export async function tts(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!env.ELEVENLABS_API_KEY) return json({ error: 'ELEVENLABS_API_KEY is not set on the server' }, 503);
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
