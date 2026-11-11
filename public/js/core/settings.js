// User settings, persisted on the device.

export const VOICE_PRESETS = [
  { id: 'siddhu', label: 'Siddhu, friendly', voiceId: 'iLrek0aeAREetkK9NhwJ' },
  { id: 'shlok', label: 'Shlok, warm', voiceId: '2i7LhYjvw41fgbcqlf3Z' },
  { id: 'pyaari', label: 'Pyaari, Hinglish', voiceId: 'EHeVIpHOvJGuhp2QcMZZ' },
  { id: 'benne', label: 'Benne, South Indian', voiceId: 'Cjxf7lo0ZVGyj0CtWa8q' },
  { id: 'vanishree', label: 'Vanishree, casual', voiceId: 'EQajdcMa8fccc3KCqwGO' },
];

export const LLM_PRESETS = {
  none: { label: 'Basic (no AI key)', baseUrl: '', model: '' },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
  },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  custom: { label: 'Other (OpenAI-compatible)', baseUrl: '', model: '' },
};

export const LANGUAGES = [
  { id: 'en-IN', label: 'English' },
  { id: 'hi-IN', label: 'Hindi / Hinglish' },
  { id: 'te-IN', label: 'Telugu' },
];

export const DEFAULTS = {
  userName: '',
  language: 'en-IN',
  handsfree: false,
  homeCity: '',
  countryCode: '91',
  mediaService: 'youtube',
  passcode: '',
  llm: { provider: 'none', baseUrl: '', apiKey: '', model: '' },
  tts: { engine: 'auto', elevenKey: '', preset: 'siddhu', voiceId: '', browserVoice: '', rate: 1 },
};

function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export function createSettings(store) {
  let current = merge(DEFAULTS, store.get('settings', {}));
  const listeners = new Set();
  return {
    get: () => current,
    set(patch) {
      current = merge(current, patch);
      store.set('settings', current);
      listeners.forEach((fn) => fn(current));
      return current;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Resolved LLM connection, or null when G1 runs in basic mode. */
    llmConfig(server = {}) {
      const { llm, passcode } = current;
      if (llm.provider !== 'none' && llm.apiKey) {
        const preset = LLM_PRESETS[llm.provider] || LLM_PRESETS.custom;
        const baseUrl = (llm.baseUrl || preset.baseUrl).replace(/\/+$/, '');
        if (!baseUrl) return null;
        return {
          url: baseUrl + '/chat/completions',
          headers: { Authorization: 'Bearer ' + llm.apiKey },
          model: llm.model || preset.model,
        };
      }
      if (server.llm) {
        return { url: '/api/llm', headers: passcode ? { 'x-g1-pass': passcode } : {}, model: llm.model || '' };
      }
      return null;
    },
    voiceId() {
      const { tts } = current;
      if (tts.voiceId) return tts.voiceId;
      return (VOICE_PRESETS.find((p) => p.id === tts.preset) || VOICE_PRESETS[0]).voiceId;
    },
  };
}
