// G1's voice. Natural voice (ElevenLabs) when a key or server is available, the device's best voice otherwise.

import { VOICE_PRESETS } from '../core/settings.js';
import { has, nativeCall, onNative } from '../native.js';

const ELEVEN = 'https://api.elevenlabs.io/v1/text-to-speech';
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Splits a reply into speakable pieces so the first words start quickly. */
export function chunksOf(text, max = 220) {
  const sentences = String(text || '').match(/[^.!?।]+[.!?।]+["')\]]*|[^.!?।]+$/g) || [];
  const out = [];
  let cur = '';
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (cur && (cur + ' ' + s).length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Ranks the device's voices for a language; natural/neural ones first. */
export function rankVoices(voices, lang) {
  const base = lang.split('-')[0];
  const score = (v) => {
    let s = 0;
    const l = (v.lang || '').replace('_', '-');
    if (l.toLowerCase() === lang.toLowerCase()) s += 60;
    else if (l.toLowerCase().startsWith(base)) s += 35;
    else if (base !== 'en' && /^en-in/i.test(l)) s += 10;
    else return -1;
    if (/natural|neural|online|premium|enhanced|wavenet/i.test(v.name)) s += 30;
    if (/google/i.test(v.name)) s += 12;
    if (/india|-in\b/i.test(v.name + l)) s += 8;
    if (v.localService === false) s += 4;
    return s;
  };
  return voices
    .map((v) => ({ v, s: score(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

export function createVoice({ settings, getServer = () => ({}), fetch: fetchImpl = (...a) => globalThis.fetch(...a), onState = () => {} }) {
  let token = 0;
  let audio = null;
  let elevenDownUntil = 0;
  let lastError = '';
  const synth = globalThis.speechSynthesis;

  const cfg = () => settings.get();
  const elevenRoute = () => {
    const s = cfg();
    if (s.tts.engine === 'device') return null;
    if (Date.now() < elevenDownUntil) return null;
    if (s.tts.elevenKey) return { url: (voice) => `${ELEVEN}/${voice}/stream?output_format=mp3_44100_128`, headers: { 'xi-api-key': s.tts.elevenKey } };
    if (getServer().tts) return { url: () => '/api/speak', headers: s.passcode ? { 'x-g1-pass': s.passcode } : {}, viaServer: true };
    return null;
  };

  async function fetchClip(route, text) {
    const voice = settings.voiceId();
    const model = cfg().language === 'te-IN' ? 'eleven_v3' : 'eleven_flash_v2_5';
    const res = await fetchImpl(route.url(voice), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...route.headers },
      body: JSON.stringify(route.viaServer ? { text, voice_id: voice, model_id: model } : { text, model_id: model }),
    });
    if (!res.ok) throw new Error(`voice service ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }

  function playClip(src, mine) {
    return new Promise((resolve) => {
      if (mine !== token) return resolve();
      audio = audio || new Audio();
      audio.onended = audio.onerror = () => resolve();
      audio.src = src;
      audio.playbackRate = cfg().tts.rate || 1;
      audio.play().catch(() => resolve());
    });
  }

  function deviceVoice() {
    if (!synth) return null;
    const s = cfg();
    const all = synth.getVoices();
    if (s.tts.browserVoice) {
      const named = all.find((v) => v.name === s.tts.browserVoice);
      if (named) return named;
    }
    const ranked = rankVoices(all, s.language);
    if (!ranked.length) return null;
    // "change your voice" steps through presets; on the device voice that steps through the best few voices
    const step = Math.max(0, VOICE_PRESETS.findIndex((p) => p.id === s.tts.preset));
    return ranked[step % Math.min(ranked.length, 4)];
  }

  function speakOnDevice(text, mine) {
    if (has('speak')) {
      // Android app: the phone's own voice engine
      return new Promise((resolve) => {
        if (mine !== token) return resolve();
        let off = () => {};
        const done = () => {
          off();
          clearTimeout(guard);
          resolve();
        };
        const guard = setTimeout(done, 25000);
        off = onNative('tts', done);
        nativeCall('speak', text, cfg().language, cfg().tts.rate || 1);
      });
    }
    return new Promise((resolve) => {
      if (!synth || mine !== token) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const v = deviceVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || cfg().language;
      u.rate = (cfg().tts.rate || 1) * 1.02;
      u.pitch = 1;
      u.onend = u.onerror = () => resolve();
      synth.speak(u);
    });
  }

  return {
    get lastError() {
      return lastError;
    },
    engine: () => (elevenRoute() ? 'natural' : 'device'),
    deviceVoices: () => (synth ? rankVoices(synth.getVoices(), cfg().language) : []),

    /** Call from a tap: browsers only allow sound after the user touches the page. */
    unlock() {
      try {
        audio = audio || new Audio();
        audio.src = SILENCE;
        audio.play().catch(() => {});
        synth?.resume?.();
      } catch {
        /* nothing to unlock */
      }
    },

    /** Speaks text. Resolves when finished or interrupted. */
    async speak(text) {
      const parts = chunksOf(text);
      const mine = ++token;
      if (!parts.length) return;
      synth?.cancel();
      onState(true);
      try {
        const route = elevenRoute();
        if (route) {
          try {
            const clips = parts.map((p) => fetchClip(route, p));
            clips.forEach((c) => c.catch(() => {}));
            for (let i = 0; i < clips.length; i++) {
              const src = await clips[i];
              if (mine !== token) return;
              await playClip(src, mine);
              URL.revokeObjectURL(src);
            }
            lastError = '';
            return;
          } catch (e) {
            // natural voice failed: use the device voice now, and for the next minute
            lastError = String(e.message || e);
            elevenDownUntil = Date.now() + 60000;
          }
        }
        for (const p of parts) {
          if (mine !== token) return;
          await speakOnDevice(p, mine);
        }
      } finally {
        if (mine === token) onState(false);
      }
    },

    stop() {
      token++;
      nativeCall('stopSpeaking');
      try {
        synth?.cancel();
        audio?.pause();
      } catch {
        /* already quiet */
      }
      onState(false);
    },
  };
}
