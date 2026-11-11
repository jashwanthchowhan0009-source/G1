// G1's ears: the browser's speech recognition, one utterance at a time or hands-free.

export function createEars({ settings, onInterim = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {} }) {
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
