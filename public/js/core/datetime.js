// Spoken time understanding: "in 10 minutes", "kal subah 7 baje", "tomorrow at 5:30 pm".

const NUM = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
  gyarah: 11, barah: 12, pandrah: 15, bees: 20, tees: 30, pachas: 50,
};

export function wordToNum(w) {
  if (/^\d+(\.\d+)?$/.test(w)) return parseFloat(w);
  return Object.hasOwn(NUM, w) ? NUM[w] : null;
}

const SPECIAL_DURATIONS = [
  [/\b(half an hour|half hour|aadha ghanta|adha ghanta)\b/, 1800],
  [/\b(dedh ghanta|dedh ghante|one and a half hours?|an hour and a half)\b/, 5400],
  [/\b(dhai ghante|two and a half hours)\b/, 9000],
  [/\b(quarter of an hour|pauna ghanta)\b/, 900],
];

const unitSeconds = (u) => (/^s/.test(u) ? 1 : /^m/.test(u) ? 60 : 3600);

/** Finds a duration anywhere in the text. Returns { seconds, start, end, text } or null. */
export function parseDuration(input) {
  const t = String(input).toLowerCase();
  for (const [re, seconds] of SPECIAL_DURATIONS) {
    const m = re.exec(t);
    if (m) return { seconds, start: m.index, end: m.index + m[0].length, text: m[0] };
  }
  const re = /(\d+(?:\.\d+)?|\b[a-z]+)\s*-?\s*(seconds?|secs?|minutes?|mins?|minat|hours?|hrs?|ghant(?:a|e|ey)|[smh])\b/g;
  let total = 0;
  let start = -1;
  let end = -1;
  let m;
  while ((m = re.exec(t))) {
    const qty = wordToNum(m[1]);
    const numeric = /^\d/.test(m[1]);
    if (qty == null) continue;
    if (m[2].length === 1 && !numeric) continue; // "a m" inside a word is not one minute
    // parts of one duration sit next to each other: "1 hour 30 minutes", "1 hour and 30 minutes"
    if (start !== -1 && !/^\s*(and\s+)?$/.test(t.slice(end, m.index))) break;
    total += qty * unitSeconds(m[2]);
    if (start === -1) start = m.index;
    end = m.index + m[0].length;
  }
  if (start === -1 || total <= 0) return null;
  return { seconds: Math.round(total), start, end, text: t.slice(start, end) };
}

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  ravivar: 0, somvar: 1, mangalvar: 2, budhvar: 3, guruvar: 4, shukravar: 5, shanivar: 6,
};

/**
 * Finds a point in time in the text.
 * Returns { date, rest } where rest is the text with the time words removed, or null.
 */
export function parseWhen(input, now = new Date()) {
  let s = ' ' + String(input).toLowerCase().replace(/\b([ap])\.\s?m\.?/g, '$1m').replace(/\s+/g, ' ') + ' ';
  const cut = (re) => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return m;
  };
  const tidy = () =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s+(at|on|ko|pe|par|by)\s*$/, ' ')
      .trim();

  // relative: "in 10 minutes", "10 minute baad"
  const dur = parseDuration(s);
  if (dur) {
    const before = /\b(in|after|within)\s*$/.exec(s.slice(0, dur.start));
    const after = /^\s*(ke baad|baad|bad|later|from now|mein|me)\b/.exec(s.slice(dur.end));
    if (before || after) {
      const from = before ? before.index : dur.start;
      const to = after ? dur.end + after[0].length : dur.end;
      s = s.slice(0, from) + ' ' + s.slice(to);
      return { date: new Date(now.getTime() + dur.seconds * 1000), rest: tidy(), relative: true };
    }
  }

  let dayOffset = null;
  let period = null;
  let m;
  if (cut(/\b(day after tomorrow|parso|parson)\b/)) dayOffset = 2;
  else if (cut(/\b(tomorrow|tmrw|kal)\b/)) dayOffset = 1;
  else if (cut(/\b(tonight|aaj raat)\b/)) {
    dayOffset = 0;
    period = 'night';
  } else if (cut(/\b(today|aaj)\b/)) dayOffset = 0;

  let weekday = null;
  if (dayOffset === null && (m = cut(new RegExp('\\b(?:on |next |this )?(' + Object.keys(WEEKDAYS).join('|') + ')\\b')))) {
    weekday = WEEKDAYS[m[1]];
  }

  if (cut(/\b(?:in the |this )?(morning|subah|savere)\b/)) period = 'am';
  else if (cut(/\b(?:in the |this )?(afternoon|dopahar)\b/)) period = 'pm';
  else if (cut(/\b(?:in the |this )?(evening|shaam|sham)\b/)) period = 'pm';
  else if (cut(/\b(?:at )?(night|raat)\b/)) period = 'night';

  let h = null;
  let min = 0;
  let ap = null;
  if ((m = cut(/\b(?:at |@ ?)?(\d{1,2})[:.](\d{2})\s*(am|pm)?(?:\s*baje)?\b/))) {
    h = +m[1];
    min = +m[2];
    ap = m[3] || null;
  } else if ((m = cut(/\b(?:at |@ ?)?(\d{1,2})\s*(am|pm)\b/))) {
    h = +m[1];
    ap = m[2];
  } else if ((m = cut(/\b(?:(saade|sadhe|sava|paune)\s+)?(\d{1,2})\s*baje\b/))) {
    h = +m[2];
    if (m[1] === 'saade' || m[1] === 'sadhe') min = 30;
    if (m[1] === 'sava') min = 15;
    if (m[1] === 'paune') {
      h -= 1;
      min = 45;
    }
  } else if (cut(/\b(?:at )?noon\b/)) {
    h = 12;
    ap = 'pm';
  } else if (cut(/\b(?:at )?midnight\b/)) {
    h = 0;
    ap = 'am';
    if (dayOffset === null && weekday === null) dayOffset = 1;
  } else if ((m = cut(/\bat (\d{1,2})\b(?!\s*(?:%|percent|rs|rupees|degrees))/))) {
    h = +m[1];
  }

  if (h === null && dayOffset === null && weekday === null && !period) return null;
  if (h !== null && (h > 23 || min > 59)) return null;

  const base = new Date(now);
  base.setSeconds(0, 0);
  if (weekday !== null) {
    let diff = (weekday - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    dayOffset = diff;
  }

  const at = (offset, hour) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, min, 0, 0);
    return d;
  };

  let date;
  if (h === null) {
    date = at(dayOffset || 0, period === 'pm' ? 17 : period === 'night' ? 21 : 9);
  } else {
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    let settled = Boolean(ap) || h > 12 || h === 0;
    if (!settled && period) {
      if (period === 'pm' && h < 12) h += 12;
      else if (period === 'night') h = h === 12 ? 0 : h >= 5 ? h + 12 : h;
      else if (period === 'am' && h === 12) h = 0;
      settled = true;
    }
    if (settled) {
      date = at(dayOffset || 0, h);
    } else if (!dayOffset) {
      // "at 5" today: the next 5 o'clock that is still ahead
      const options = [at(0, h % 12), at(0, (h % 12) + 12)];
      date = options.find((d) => d > now) || at(1, h >= 7 && h <= 11 ? h : (h % 12) + 12);
    } else {
      // "tomorrow at 5": people mean 7-11 in the morning, 12-6 after noon
      date = at(dayOffset, h >= 7 && h <= 11 ? h : (h % 12) + 12);
    }
  }
  if (date <= now) date.setDate(date.getDate() + 1);
  return { date, rest: tidy(), relative: false };
}

const hi = (lang) => lang === 'hi-IN';

export function sayDuration(seconds, lang = 'en-IN') {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const parts = [];
  if (hi(lang)) {
    if (h) parts.push(`${h} ghante`);
    if (m) parts.push(`${m} minute`);
    if (s && !h) parts.push(`${s} second`);
  } else {
    if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
    if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
    if (s && !h) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  }
  return parts.join(' ') || (hi(lang) ? '0 second' : '0 seconds');
}

export function sayClock(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function sayDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "today at 5 PM", "kal 7 AM pe", "on Friday at 9 AM". */
export function sayWhen(date, now = new Date(), lang = 'en-IN') {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86400000);
  const clock = sayClock(date);
  if (hi(lang)) {
    const day = days === 0 ? 'aaj' : days === 1 ? 'kal' : days === 2 ? 'parso' : `${date.getDate()} ${MONTHS[date.getMonth()]} ko`;
    return `${day} ${clock} pe`;
  }
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? `on ${DAY_NAMES[date.getDay()]}` : `on ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return `${day} at ${clock}`;
}
