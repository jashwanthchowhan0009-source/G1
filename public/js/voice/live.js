// Live voice: talk to G1 like a phone call. Audio streams both ways with Gemini Live, so G1 starts
// answering while you finish your sentence, and you can cut in at any time.
//
// Safety stays on the device: messages, payments and deletions still need a spoken "haan" or a tap on
// Yes, and that check is done here in code from the transcript, never by the AI.

import { buildSystemPrompt } from '../core/persona.js';
import { yesNo } from '../core/nlu.js';

const IN_RATE = 16000;
const OUT_RATE = 24000;
const IDLE_MS = 45000; // nobody talking for this long: hang up (saves the free quota)

// Records the mic as 16 kHz mono PCM in ~100 ms chunks.
const WORKLET = `
class G1Mic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice().buffer, []); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('g1-mic', G1Mic);`;

const LIVE_RULES = `

Live call
- This is a live voice call. Keep every reply to one or two short spoken sentences, then stop and let the user talk.
- When a tool answers waiting_for_user_yes_or_no, ask that question in a few words and stop. Do not say it is done. The device itself does it or cancels it after the user answers, and then tells you in a message starting with [device]. Only then say the result.
- When the user says bye, bas, that's all, or thank you and nothing else, say a short warm goodbye and call end_conversation.`;

const END_TOOL = { name: 'end_conversation', description: 'Hang up the live call after saying goodbye.', parameters: { type: 'object', properties: {} } };

/** OpenAI-style tool schemas -> Gemini function declarations, keeping only fields Gemini accepts. */
export function toDeclarations(toolSchemas) {
  const clean = (p) => {
    if (!p || typeof p !== 'object') return p;
    const out = {};
    for (const k of ['type', 'description', 'enum', 'required']) if (p[k] !== undefined) out[k] = p[k];
    if (Array.isArray(out.enum)) out.enum = out.enum.filter((v) => v !== '' && v != null).map(String);
    if (out.enum && !out.enum.length) delete out.enum;
    if (p.properties) out.properties = Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, clean(v)]));
    if (p.items) out.items = clean(p.items);
    return out;
  };
  return toolSchemas.map((t) => {
    const f = t.function || t;
    const d = { name: f.name, description: String(f.description || '').slice(0, 1000) };
    if (f.parameters && Object.keys(f.parameters.properties || {}).length) d.parameters = clean(f.parameters);
    return d;
  });
}

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function createLive({ skills, ctx, settings, serverPost, timeZone = '', on = {} }) {
  const emit = (name, ...a) => on[name]?.(...a);
  let ws = null;
  let mic = null; // { stream, ctx, node }
  let out = null; // AudioContext for G1's voice
  let playing = [];
  let playAt = 0;
  let pending = null; // { confirm } waiting for the user's yes or no
  let heard = ''; // what the user said this turn (transcript)
  let said = '';
  let idleTimer = null;
  let decideTimer = null; // waits for the user to finish their yes/no before acting
  let ending = false;
  let active = false;
  let model = '';

  const hi = () => settings.get().language === 'hi-IN';
  const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  function poke() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop('idle'), IDLE_MS);
  }

  // ---------------------------------------------------------------- G1's voice out
  function play(base64) {
    if (!out) return;
    const bin = atob(base64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    const buf = out.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = out.createBufferSource();
    src.buffer = buf;
    src.connect(out.destination);
    playAt = Math.max(playAt, out.currentTime + 0.03);
    src.start(playAt);
    playAt += buf.duration;
    playing.push(src);
    src.onended = () => {
      playing = playing.filter((s) => s !== src);
      if (!playing.length) {
        emit('state', 'listening');
        if (ending) stop('bye');
      }
    };
    emit('state', 'speaking');
  }

  function hush() {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        /* already done */
      }
    }
    playing = [];
    playAt = 0;
  }

  // ---------------------------------------------------------------- the mic in
  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ac = new AudioContext({ sampleRate: IN_RATE });
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(ac, 'g1-mic');
    node.port.onmessage = (e) => send({ realtimeInput: { audio: { mimeType: `audio/pcm;rate=${IN_RATE}`, data: b64(e.data) } } });
    ac.createMediaStreamSource(stream).connect(node);
    mic = { stream, ac, node };
  }

  function closeMic() {
    if (!mic) return;
    mic.node.port.onmessage = null;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.ac.close().catch(() => {});
    mic = null;
  }

  // ---------------------------------------------------------------- tools
  async function runTool(call) {
    if (call.name === 'end_conversation') {
      ending = true;
      if (!playing.length) setTimeout(() => !playing.length && stop('bye'), 1500);
      return { ok: true };
    }
    const skill = skills.get(call.name);
    if (!skill) return { ok: false, error: 'unknown_tool' };
    let res;
    try {
      res = (await skill.run(call.args || {}, ctx)) || { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
    if (res.confirm) {
      pending = res.confirm;
      heard = ''; // only words spoken after the question count as the answer
      emit('card', res.confirm.card || { type: 'confirm', title: res.confirm.say });
      return { status: 'waiting_for_user_yes_or_no', ask: res.confirm.say };
    }
    if (res.card) emit('card', res.card);
    return { ok: res.ok !== false, say: res.say || '', ...(res.data || {}) };
  }

  /** The user's yes or no for a waiting action (spoken or tapped). Done here, not by the AI. */
  async function answer(choice) {
    if (!pending || !choice) return false;
    const action = pending;
    pending = null;
    heard = '';
    emit('card', null);
    let note;
    if (choice === 'yes') {
      try {
        const res = (await action.proceed()) || {};
        if (res.card) emit('card', res.card);
        note = `[device] The user said yes and it is done: ${res.say || 'done'}`;
      } catch (e) {
        note = `[device] The user said yes but it failed: ${String(e?.message || e)}`;
      }
    } else {
      note = '[device] The user said no, so it was not done.';
    }
    send({ clientContent: { turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: true } });
    return true;
  }

  // ---------------------------------------------------------------- the call
  async function connect(prefer = {}) {
    const t = await serverPost('/api/live', prefer);
    if (!t?.token) throw new Error(t?.error || 'no live token');
    model = t.model;
    const tools = [{ functionDeclarations: [...toDeclarations(skills.toolSchemas()), END_TOOL] }];
    const system =
      buildSystemPrompt({ settings: settings.get(), memory: ctx.store.get('memory', []), now: ctx.now(), timeZone }) + LIVE_RULES;
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`${t.ws}?access_token=${encodeURIComponent(t.token)}`);
      let ready = false;
      sock.onopen = () =>
        sock.send(JSON.stringify({
          setup: {
            model: `models/${t.model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.geminiVoice?.() || 'Achird' } } },
            },
            systemInstruction: { parts: [{ text: system }] },
            tools,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
      sock.onmessage = async (ev) => {
        let m;
        try {
          m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
        } catch {
          return;
        }
        if (m.setupComplete && !ready) {
          ready = true;
          ws = sock;
          serverPost('/api/live', { ok: true, model: t.model, version: t.version }).catch(() => {});
          resolve();
          return;
        }
        handle(m);
      };
      sock.onclose = (ev) => {
        if (!ready) return reject(new Error(`live closed ${ev.code} ${ev.reason || ''}`.trim()));
        if (active) stop(ev.code === 1000 ? 'closed' : 'dropped');
      };
      sock.onerror = () => {
        /* onclose follows with the reason */
      };
    });
  }

  async function handle(m) {
    const sc = m.serverContent;
    if (sc) {
      poke();
      if (sc.interrupted) {
        hush(); // the user cut in
        emit('state', 'listening');
      }
      if (sc.inputTranscription?.text) {
        heard += (heard && !/^\s/.test(sc.inputTranscription.text) ? ' ' : '') + sc.inputTranscription.text;
        emit('heard', heard.trim());
        if (pending) {
          // decide on the whole answer, not the first fragment ("ha..." could become "ha, ruko")
          clearTimeout(decideTimer);
          decideTimer = setTimeout(() => pending && answer(yesNo(heard.trim())), 900);
        }
      }
      if (sc.outputTranscription?.text) {
        if (pending && heard.trim()) {
          clearTimeout(decideTimer); // G1 started replying: the user has finished
          await answer(yesNo(heard.trim()));
        }
        if (heard) {
          said = '';
          heard = '';
        }
        said += sc.outputTranscription.text;
        emit('said', said.trim());
      }
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) play(p.inlineData.data);
      if (sc.turnComplete) {
        heard = '';
        if (!playing.length) emit('state', 'listening');
      }
    }
    if (m.toolCall?.functionCalls?.length) {
      emit('state', 'thinking');
      const functionResponses = [];
      for (const call of m.toolCall.functionCalls) {
        let response = await runTool(call);
        if (JSON.stringify(response).length > 8000) response = { ok: response.ok, say: String(response.say || '').slice(0, 1000), note: 'long result shortened' };
        functionResponses.push({ id: call.id, name: call.name, response });
      }
      send({ toolResponse: { functionResponses } });
    }
    if (m.goAway) emit('notice', hi() ? 'Call jaldi khatam hogi.' : 'The call will end soon.');
  }

  async function start() {
    if (active) return true;
    active = true;
    ending = false;
    pending = null;
    heard = said = '';
    emit('state', 'connecting');
    try {
      out = new AudioContext({ sampleRate: OUT_RATE });
      await out.resume();
      try {
        await connect();
      } catch (first) {
        // the preferred model may be busy: try the others once
        let ok = false;
        for (const name of ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest']) {
          if (name === model) continue;
          try {
            await connect({ model: name });
            ok = true;
            break;
          } catch {
            /* next */
          }
        }
        if (!ok) throw first;
      }
      await openMic();
      poke();
      emit('state', 'listening');
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      stop('failed');
      emit('error', /Permission|NotAllowed/i.test(msg) ? 'mic' : msg);
      return false;
    }
  }

  function stop(why = 'user') {
    if (!active && !ws) return;
    active = false;
    clearTimeout(idleTimer);
    clearTimeout(decideTimer);
    closeMic();
    hush();
    if (pending) emit('card', null);
    pending = null;
    try {
      ws?.close(1000);
    } catch {
      /* closed */
    }
    ws = null;
    out?.close().catch(() => {});
    out = null;
    emit('state', 'off', why);
  }

  return {
    start,
    stop,
    answer: (choice) => answer(choice),
    get active() {
      return active;
    },
    get model() {
      return model;
    },
    /** Live calling needs a Gemini key on the server and a browser with mic streaming. */
    supported: (server) =>
      Boolean(server?.llm && server?.ttsEngine === 'gemini' && globalThis.AudioWorkletNode && globalThis.WebSocket && navigator.mediaDevices?.getUserMedia),
  };
}
