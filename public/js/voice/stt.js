// G1's ears: the browser's speech recognition, one utterance at a time or hands-free.

import { has, nativeCall, onNative } from '../native.js';

/** Inside the G1 Android app: the phone's own speech recognition. Same interface as the browser ears. */
function createNativeEars({ settings, onInterim, onFinal, onState, onError }) {
  let mode = 'off';
  let paused = false;
  let active = false;
  let cancelled = false;
  let failures = 0;
  let heard = '';
  let timer = null;

  const start = () => {
    if (paused || active) return;
    cancelled = false;
    heard = '';
    active = true;
    nativeCall('listen', settings.get().language);
  };
  const halt = () => {
    clearTimeout(timer);
    cancelled = true;
    active = false;
    nativeCall('stopListening', false);
  };

  onNative('speech', (e) => {
    if (cancelled) return;
    if (e.kind === 'start') onState(true);
    else if (e.kind === 'partial') {
      heard = e.text;
      onInterim(e.text);
    } else if (e.kind === 'final') heard = e.text || heard;
    else if (e.kind === 'error') {
      if (e.text === 'mic-blocked' || e.text === 'unsupported') {
        mode = 'off';
        onError(e.text);
      } else if (e.text === 'no-network') {
        failures++;
        onError('no-network');
      }
    } else if (e.kind === 'end') {
      active = false;
      const text = heard.trim();
      heard = '';
      const was = mode;
      if (mode === 'once') mode = 'off';
      onState(false);
      if (text) {
        failures = 0;
        onFinal(text, { handsfree: was === 'handsfree' });
      }
      if (mode === 'handsfree' && !paused) {
        if (failures < 4) timer = setTimeout(start, 300 + failures * 1500);
        else {
          mode = 'off';
          onError('handsfree-stopped');
        }
      }
    }
  });

  return {
    supported: true,
    isListening: () => active,
    mode: () => mode,
    listenOnce() {
      paused = false;
      if (mode !== 'handsfree') mode = 'once';
      start();
    },
    finish: () => nativeCall('stopListening', true),
    startHandsfree() {
      mode = 'handsfree';
      paused = false;
      failures = 0;
      start();
    },
    stopHandsfree() {
      mode = 'off';
      halt();
      onState(false);
    },
    pause() {
      paused = true;
      halt();
    },
    resume() {
      paused = false;
      if (mode === 'handsfree') start();
    },
  };
}

export function createEars({ settings, onInterim = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {} }) {
  if (has('listen')) return createNativeEars({ settings, onInterim, onFinal, onState, onError });
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  let rec = null;
  let mode = 'off'; // 'off' | 'once' | 'handsfree'
  let paused = false;
  let active = false;
  let failures = 0;
  let restartTimer = null;

  function start() {
    if (!SR || active || paused) return;
    const me = new SR();
    rec = me;
    let ended = false;
    rec.lang = settings.get().language;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let interim = '';
    rec.onstart = () => {
      if (rec !== me) return; // it was cancelled before it began
      active = true;
      onState(true);
    };
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += piece;
        else interim += piece;
      }
      onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        mode = 'off';
        onError('mic-blocked');
      } else if (e.error === 'network') {
        failures++;
        onError('no-network');
      } else if (e.error === 'audio-capture') {
        mode = 'off';
        onError('no-mic');
      }
    };
    rec.onend = () => {
      if (ended) return; // an utterance is delivered once, whatever the recogniser does afterwards
      ended = true;
      if (rec !== me) return; // cancelled on purpose (G1 started talking): drop what it caught
      rec = null;
      active = false;
      const heard = (finalText || interim).trim();
      const wasMode = mode;
      if (mode === 'once') mode = 'off';
      onState(false);
      if (heard) {
        failures = 0;
        onFinal(heard, { handsfree: wasMode === 'handsfree' });
      }
      if (mode === 'handsfree' && !paused) {
        // keep listening; back off if the recogniser keeps failing
        clearTimeout(restartTimer);
        if (failures < 4) restartTimer = setTimeout(start, 250 + failures * 1500);
        else {
          mode = 'off';
          onError('handsfree-stopped');
        }
      }
    };
    try {
      me.start();
    } catch {
      rec = null;
      active = false;
    }
  }

  function halt() {
    clearTimeout(restartTimer);
    const old = rec;
    rec = null;
    active = false;
    try {
      old?.abort();
    } catch {
      /* not running */
    }
  }

  return {
    supported: Boolean(SR),
    isListening: () => active,
    mode: () => mode,
    /** Listen for one thing the user says. */
    listenOnce() {
      if (!SR) return onError('unsupported');
      paused = false;
      if (mode !== 'handsfree') mode = 'once';
      start();
    },
    /** Finish the current utterance now (the user tapped again). */
    finish() {
      try {
        rec?.stop();
      } catch {
        /* not running */
      }
    },
    startHandsfree() {
      if (!SR) return onError('unsupported');
      mode = 'handsfree';
      paused = false;
      failures = 0;
      start();
    },
    stopHandsfree() {
      mode = 'off';
      halt();
      onState(false);
    },
    /** While G1 is talking it must not hear itself. */
    pause() {
      paused = true;
      halt();
    },
    resume() {
      paused = false;
      if (mode === 'handsfree') start();
    },
  };
}
