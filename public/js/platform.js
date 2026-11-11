// What G1 can do on the device it is running on. This file is the only place that touches
// browser device APIs, so a native Android shell can replace it later (see window.G1Native).

import { has, nativeCall, nativeJson } from './native.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPlatform() {
  let torchStream = null;

  return {
    /**
     * Opens a link: tel:, sms:, upi:, mailto:, or a web page.
     * Returns 'placed' (done with no tap, native shell only), 'opened', or 'blocked'.
     */
    open(url) {
      const done = nativeCall('open', url);
      if (done) return done;
      if (/^https?:/i.test(url)) {
        const w = window.open(url, '_blank');
        if (!w) return 'blocked';
        try {
          w.opener = null;
        } catch {
          /* cross-origin */
        }
        return 'opened';
      }
      window.location.href = url;
      return 'opened';
    },

    /** True inside the G1 Android app. */
    isApp: () => has('permissions'),

    /** The phone's address book (Android app, with permission). [] elsewhere. */
    deviceContacts() {
      if (!has('contacts')) return [];
      const now = Date.now();
      if (!this._contacts || now - this._contactsAt > 60000) {
        this._contacts = nativeJson('contacts', []);
        this._contactsAt = now;
      }
      return this._contacts;
    },

    /** { microphone: true, contacts: false, ... } in the Android app, null in a browser. */
    permissions: () => (has('permissions') ? nativeJson('permissions', {}) : null),
    requestPermission(name) {
      this._contacts = null;
      nativeCall('request', name);
    },

    /** Share text through Android's share sheet or a named app. Returns 'opened', 'blocked' or 'needs-tap'. */
    share(text, app = '') {
      if (has('share')) return nativeCall('share', text, app) || 'blocked';
      return navigator.share ? 'needs-tap' : 'blocked';
    },

    /** A real alarm in the phone's clock app. False when G1 cannot set one here. */
    setAlarm: (hour, minute, label) => (has('setAlarm') ? Boolean(nativeCall('setAlarm', hour, minute, label || '')) : false),

    geolocate() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('no geolocation'));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          (e) => reject(e),
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
        );
      });
    },

    async battery() {
      if (!navigator.getBattery) throw new Error('no battery api');
      const b = await navigator.getBattery();
      return { level: b.level, charging: b.charging };
    },

    online: () => navigator.onLine !== false,

    async torch(on) {
      if (!on) {
        torchStream?.getTracks().forEach((t) => t.stop());
        torchStream = null;
        return;
      }
      if (!torchStream) torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const track = torchStream.getVideoTracks()[0];
      if (!track.getCapabilities?.().torch) {
        track.stop();
        torchStream = null;
        throw new Error('torch not supported');
      }
      await track.applyConstraints({ advanced: [{ torch: true }] });
    },

    /** Takes one photo with the back camera. Resolves with a JPEG data URL. */
    async capturePhoto() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      try {
        const video = document.createElement('video');
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        await wait(650); // let exposure settle
        const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale) || 640;
        canvas.height = Math.round(video.videoHeight * scale) || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.82);
      } finally {
        stream.getTracks().forEach((t) => t.stop());
      }
    },

    savePhoto(dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `g1-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    vibrate(pattern) {
      try {
        navigator.vibrate?.(pattern);
      } catch {
        /* not supported */
      }
    },

    async notify(title, body) {
      try {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission === 'granted') new Notification(title, { body, icon: '/icons/icon.svg' });
      } catch {
        /* notifications are a bonus */
      }
    },
  };
}
