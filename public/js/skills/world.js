// The world outside: weather, maps, music, lookups, travel, camera, device.

import { L, ask, fail, norm, enc, getJson } from './util.js';

const WEATHER = {
  0: ['clear', 'saaf aasman'],
  1: ['mostly clear', 'lagbhag saaf'],
  2: ['partly cloudy', 'thode badal'],
  3: ['cloudy', 'badal chhaye hain'],
  45: ['foggy', 'kohra'],
  48: ['foggy', 'kohra'],
  51: ['light drizzle', 'halki boonda-baandi'],
  53: ['drizzle', 'boonda-baandi'],
  55: ['heavy drizzle', 'tez boonda-baandi'],
  61: ['light rain', 'halki baarish'],
  63: ['rain', 'baarish'],
  65: ['heavy rain', 'tez baarish'],
  71: ['light snow', 'halki barf'],
  73: ['snow', 'barf'],
  75: ['heavy snow', 'tez barf'],
  80: ['rain showers', 'baarish ke chheente'],
  81: ['rain showers', 'baarish ke chheente'],
  82: ['heavy showers', 'tez baarish'],
  95: ['a thunderstorm', 'aandhi-toofan'],
  96: ['a thunderstorm with hail', 'ole ke saath toofan'],
  99: ['a thunderstorm with hail', 'ole ke saath toofan'],
};
const describe = (ctx, code) => {
  const d = WEATHER[code] || ['mixed weather', 'mila-jula mausam'];
  return L(ctx, d[0], d[1]);
};

// Feeds built for endless scrolling. G1 does the task instead of opening the feed.
const FEEDS = /^(instagram|insta|reels|facebook|fb|tiktok|twitter|x|snapchat|shorts|youtube shorts|moj|josh|sharechat)$/;

const SITES = {
  google: 'https://www.google.com',
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  maps: 'https://maps.google.com',
  whatsapp: 'https://web.whatsapp.com',
  irctc: 'https://www.irctc.co.in',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  github: 'https://github.com',
  wikipedia: 'https://en.wikipedia.org',
  calendar: 'https://calendar.google.com',
  drive: 'https://drive.google.com',
};

async function locate(ctx, place) {
  if (place) {
    const g = await getJson(ctx, `https://geocoding-api.open-meteo.com/v1/search?name=${enc(place)}&count=1&language=en&format=json`);
    const hit = g.results?.[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
  }
  try {
    const pos = await ctx.platform.geolocate();
    return { lat: pos.lat, lon: pos.lon, name: '' };
  } catch {
    const home = ctx.settings.get().homeCity;
    return home ? locate(ctx, home) : null;
  }
}

function openLink(ctx, url, title, label, text = '') {
  const result = ctx.platform.open(url);
  return { opened: result !== 'blocked', card: { type: 'action', title, text, label, url } };
}

export const worldSkills = [
  {
    name: 'get_weather',
    description: 'Current weather and the forecast for today or tomorrow. Without a place it uses where the user is.',
    parameters: {
      type: 'object',
      properties: { place: { type: 'string', description: 'City or town' }, day: { type: 'string', enum: ['today', 'tomorrow'] } },
    },
    async run(args, ctx) {
      let where;
      try {
        where = await locate(ctx, args.place);
      } catch {
        return fail(ctx, "I can't reach the weather service right now.", 'Abhi mausam ki jaankari nahi mil rahi.', { error: 'network' });
      }
      if (!where) {
        return args.place
          ? fail(ctx, `I couldn't find ${args.place}.`, `${args.place} nahi mila.`, { error: 'place_not_found' })
          : ask(ctx, 'Which city?', 'Kaun se sheher ka?');
      }
      let w;
      try {
        w = await getJson(
          ctx,
          `https://api.open-meteo.com/v1/forecast?latitude=${where.lat}&longitude=${where.lon}` +
            '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2',
        );
      } catch {
        return fail(ctx, "I can't reach the weather service right now.", 'Abhi mausam ki jaankari nahi mil rahi.', { error: 'network' });
      }
      const i = args.day === 'tomorrow' ? 1 : 0;
      const hi = Math.round(w.daily.temperature_2m_max[i]);
      const lo = Math.round(w.daily.temperature_2m_min[i]);
      const rain = w.daily.precipitation_probability_max?.[i] ?? null;
      const place = where.name || L(ctx, 'here', 'yahan');
      const inPlace = where.name ? L(ctx, ` in ${where.name}`, `${where.name} mein `) : '';
      let say;
      let temp;
      let summary;
      if (i === 1) {
        summary = describe(ctx, w.daily.weather_code[1]);
        temp = hi;
        say = L(
          ctx,
          `Tomorrow${inPlace}: ${summary}, ${lo} to ${hi} degrees${rain >= 40 ? `, ${rain} percent chance of rain` : ''}.`,
          `Kal ${inPlace}${summary}, ${lo} se ${hi} degree${rain >= 40 ? `, baarish ke ${rain} percent chance` : ''}.`,
        );
      } else {
        summary = describe(ctx, w.current.weather_code);
        temp = Math.round(w.current.temperature_2m);
        say = L(
          ctx,
          `It's ${temp} degrees and ${summary}${inPlace}. High of ${hi}${rain >= 40 ? `, and ${rain} percent chance of rain, so keep an umbrella` : ''}.`,
          `${inPlace}abhi ${temp} degree hai, ${summary}. Aaj ${hi} tak jayega${rain >= 40 ? `, aur baarish ke ${rain} percent chance hain, chhata rakh lena` : ''}.`,
        );
      }
      return {
        ok: true,
        say,
        data: { place, day: i ? 'tomorrow' : 'today', temperature_c: temp, summary, high_c: hi, low_c: lo, rain_chance_percent: rain, humidity_percent: w.current.relative_humidity_2m, wind_kmh: w.current.wind_speed_10m },
        card: { type: 'weather', place, temp, summary, hi, lo, rain },
      };
    },
  },
  {
    name: 'navigate',
    description: 'Open turn-by-turn directions to a place.',
    parameters: {
      type: 'object',
      properties: { destination: { type: 'string' }, mode: { type: 'string', enum: ['driving', 'walking', 'transit', 'two-wheeler'] } },
      required: ['destination'],
    },
    run(args, ctx) {
      const dest = String(args.destination || '').trim();
      if (!dest) return ask(ctx, 'Where to?', 'Kahan jana hai?');
      const mode = { walking: 'walking', transit: 'transit', 'two-wheeler': 'two-wheeler' }[args.mode] || 'driving';
      const url = `https://www.google.com/maps/dir/?api=1&destination=${enc(dest)}&travelmode=${mode}`;
      const { card } = openLink(ctx, url, dest, L(ctx, 'Start directions', 'Rasta dikhao'));
      return { ok: true, say: L(ctx, `Here's the way to ${dest}.`, `${dest} ka rasta khol diya.`), data: { destination: dest, mode }, card };
    },
  },
  {
    name: 'find_nearby',
    description: 'Find places near the user, such as petrol pumps, ATMs, hospitals or restaurants.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run(args, ctx) {
      const q = String(args.query || '').trim();
      if (!q) return ask(ctx, 'What are you looking for?', 'Kya dhundna hai?');
      const url = `https://www.google.com/maps/search/?api=1&query=${enc(q + ' near me')}`;
      const { card } = openLink(ctx, url, q, L(ctx, 'Show on map', 'Map pe dikhao'));
      return { ok: true, say: L(ctx, `Showing ${q} near you.`, `Paas ke ${q} dikha raha hu.`), data: { query: q }, card };
    },
  },
  {
    name: 'where_am_i',
    description: "Tell the user's current location.",
    parameters: { type: 'object', properties: {} },
    async run(_args, ctx) {
      let pos;
      try {
        pos = await ctx.platform.geolocate();
      } catch {
        return fail(ctx, "I can't get your location. Allow location access for G1.", 'Location nahi mil rahi. G1 ko location ki permission do.', { error: 'no_location' });
      }
      let place = '';
      try {
        const r = await getJson(ctx, `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${pos.lat}&lon=${pos.lon}`);
        const a = r.address || {};
        place = [a.suburb || a.neighbourhood || a.village, a.city || a.town || a.county, a.state].filter(Boolean).join(', ');
      } catch {
        /* coordinates are still useful */
      }
      const url = `https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lon}`;
      return {
        ok: true,
        say: place ? L(ctx, `You're in ${place}.`, `Tum ${place} mein ho.`) : L(ctx, "I have your position but not the place name. It's on the map.", 'Position mil gayi, jagah ka naam nahi. Map pe dekh lo.'),
        data: { place, latitude: pos.lat, longitude: pos.lon },
        card: { type: 'action', title: place || L(ctx, 'Your location', 'Tumhari location'), text: `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`, label: L(ctx, 'Open map', 'Map kholo'), url },
      };
    },
  },
  {
    name: 'play_media',
    description: 'Play a song, artist, playlist, podcast or video.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, service: { type: 'string', enum: ['youtube', 'youtube_music', 'spotify'] } },
      required: ['query'],
    },
    run(args, ctx) {
      const q = String(args.query || '').trim();
      if (!q) return ask(ctx, 'What do you want to hear?', 'Kya sunna hai?');
      const service = args.service || ctx.settings.get().mediaService || 'youtube';
      const url =
        service === 'spotify'
          ? `https://open.spotify.com/search/${enc(q)}`
          : service === 'youtube_music'
            ? `https://music.youtube.com/search?q=${enc(q)}`
            : `https://www.youtube.com/results?search_query=${enc(q)}`;
      const name = { spotify: 'Spotify', youtube_music: 'YouTube Music', youtube: 'YouTube' }[service];
      const { card } = openLink(ctx, url, q, L(ctx, `Play on ${name}`, `${name} pe chalao`));
      return { ok: true, say: L(ctx, `Here's ${q} on ${name}.`, `${q} ${name} pe laga diya.`), data: { query: q, service, note: 'Opened search results; the user picks the track.' }, card };
    },
  },
  {
    name: 'web_lookup',
    description: 'Look up a factual topic (person, place, thing, concept) and get a short summary from Wikipedia.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(args, ctx) {
      const q = String(args.query || '').trim();
      if (!q) return ask(ctx, 'What should I look up?', 'Kya dhundna hai?');
      const searchUrl = `https://www.google.com/search?q=${enc(q)}`;
      try {
        const found = await getJson(ctx, `https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc(q)}&limit=1&namespace=0&format=json&origin=*`);
        const title = found?.[1]?.[0];
        if (!title) throw new Error('no result');
        const page = await getJson(ctx, `https://en.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, '_'))}`);
        const extract = String(page.extract || '').trim();
        if (!extract) throw new Error('empty');
        const short = extract.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
        return {
          ok: true,
          say: short,
          data: { title: page.title, summary: extract.slice(0, 900), source: 'Wikipedia' },
          card: { type: 'info', title: page.title, text: page.description || '', label: L(ctx, 'Read more', 'Aur padho'), url: page.content_urls?.desktop?.page || searchUrl },
        };
      } catch {
        ctx.platform.open(searchUrl);
        return {
          ok: false,
          say: L(ctx, `I couldn't find a quick answer, so I opened a search for ${q}.`, `Seedha jawab nahi mila, ${q} search khol diya.`),
          data: { error: 'no_summary', opened_search: true },
          card: { type: 'action', title: q, label: L(ctx, 'Open search', 'Search kholo'), url: searchUrl },
        };
      }
    },
  },
  {
    name: 'open_website',
    description: 'Open a website by name or address. Endless-scroll feed apps are not opened; offer to do the actual task instead.',
    parameters: { type: 'object', properties: { site: { type: 'string', description: 'Site name or URL' } }, required: ['site'] },
    run(args, ctx) {
      const raw = String(args.site || '').trim();
      const q = norm(raw).replace(/\b(app|website|site|dot com|\.com)\b/g, '').trim();
      if (!q) return ask(ctx, 'Which site?', 'Kaun si site?');
      if (FEEDS.test(q)) {
        return {
          ok: false,
          say: L(
            ctx,
            "Scrolling feeds isn't my thing. Tell me what you need from it, like messaging someone or finding a video, and I'll do that.",
            'Feed scroll karna mera kaam nahi hai. Batao kya chahiye, kisi ko message ya koi video, woh kar deta hu.',
          ),
          data: { error: 'feeds_not_supported', hint: 'Offer to message, search or play something specific instead.' },
        };
      }
      const url = SITES[q] || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw.replace(/^https?:\/\//, '')) ? 'https://' + raw.replace(/^https?:\/\//, '') : `https://www.google.com/search?q=${enc(raw)}`);
      const { card } = openLink(ctx, url, raw, L(ctx, 'Open', 'Kholo'));
      return { ok: true, say: L(ctx, `Opening ${raw}.`, `${raw} khol raha hu.`), data: { opened: url }, card };
    },
  },
  {
    name: 'travel_search',
    description: 'Search for hotels, flights, trains or buses. Opens results for the user to choose; booking and payment are finished by the user.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['hotel', 'flight', 'train', 'bus'] },
        to: { type: 'string', description: 'Destination city' },
        from: { type: 'string', description: 'Starting city' },
        date: { type: 'string', description: 'Travel or check-in date as YYYY-MM-DD' },
        nights: { type: 'integer', description: 'Hotel nights, default 1' },
        guests: { type: 'integer', description: 'Hotel guests, default 2' },
      },
      required: ['kind', 'to'],
    },
    run(args, ctx) {
      const to = String(args.to || '').trim();
      if (!to) return ask(ctx, 'Where to?', 'Kahan ke liye?');
      const from = String(args.from || ctx.settings.get().homeCity || '').trim();
      const date = String(args.date || '').trim();
      const kind = args.kind || 'hotel';
      if (kind !== 'hotel' && !from) return ask(ctx, 'From which city?', 'Kahan se?');
      let url;
      let title;
      if (kind === 'hotel') {
        title = L(ctx, `Hotels in ${to}`, `${to} mein hotels`);
        const checkin = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00') : null;
        if (checkin && !Number.isNaN(checkin.getTime())) {
          // real availability for the exact dates
          const out = new Date(checkin.getTime() + Math.max(1, Number(args.nights) || 1) * 86400000);
          const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          url = `https://www.booking.com/searchresults.html?ss=${enc(to)}&checkin=${ymd(checkin)}&checkout=${ymd(out)}&group_adults=${Math.max(1, Number(args.guests) || 2)}&no_rooms=1`;
        } else {
          url = `https://www.google.com/travel/search?q=${enc(`hotels in ${to}`)}`;
        }
      } else if (kind === 'flight') {
        title = `${from} → ${to}`;
        url = `https://www.google.com/travel/flights?q=${enc(`Flights from ${from} to ${to}${date ? ' on ' + date : ''}`)}`;
      } else {
        title = `${from} → ${to}`;
        url = `https://www.google.com/search?q=${enc(`${kind} from ${from} to ${to}${date ? ' on ' + date : ''}`)}`;
      }
      const { card } = openLink(ctx, url, title, L(ctx, 'See options', 'Options dekho'), date);
      return {
        ok: true,
        say: L(ctx, `Here are ${kind} options for ${to}. Pick one and I'll help with the rest.`, `${to} ke liye ${kind} options khol diye. Ek chuno, baaki main dekh lunga.`),
        data: { kind, from, to, date, note: 'Opened search results. Booking and payment are completed by the user.' },
        card,
      };
    },
  },
  {
    name: 'look',
    description: 'Use the camera to see what is in front of the user and answer a question about it (read text, identify things, describe a scene).',
    parameters: { type: 'object', properties: { question: { type: 'string' } } },
    async run(args, ctx) {
      if (!ctx.vision) {
        return fail(ctx, 'I need an AI key before I can see. Add one in settings.', 'Dekhne ke liye AI key chahiye. Settings mein daal do.', { error: 'vision_unavailable' });
      }
      let photo;
      try {
        photo = await ctx.platform.capturePhoto();
      } catch {
        return fail(ctx, "I can't open the camera. Allow camera access for G1.", 'Camera nahi khul raha. G1 ko camera ki permission do.', { error: 'no_camera' });
      }
      try {
        const answer = await ctx.vision(photo, String(args.question || 'What is this?'));
        return { ok: true, say: answer, data: { seen: answer }, card: { type: 'photo', src: photo } };
      } catch (e) {
        return fail(ctx, "I took the photo but couldn't work out what's in it.", 'Photo le li par samajh nahi paya.', { error: String(e.message || e) });
      }
    },
  },
  {
    name: 'take_photo',
    description: 'Take a photo with the camera and save it.',
    parameters: { type: 'object', properties: {} },
    async run(_args, ctx) {
      try {
        const photo = await ctx.platform.capturePhoto();
        ctx.platform.savePhoto?.(photo);
        return { ok: true, say: L(ctx, 'Got it. Saved to your downloads.', 'Photo le li. Downloads mein save hai.'), data: { saved: true }, card: { type: 'photo', src: photo } };
      } catch {
        return fail(ctx, "I can't open the camera. Allow camera access for G1.", 'Camera nahi khul raha. G1 ko camera ki permission do.', { error: 'no_camera' });
      }
    },
  },
  {
    name: 'device_status',
    description: 'Battery level, charging state and whether the device is online.',
    parameters: { type: 'object', properties: {} },
    async run(_args, ctx) {
      const b = await ctx.platform.battery().catch(() => null);
      const online = ctx.platform.online();
      if (!b) {
        return { ok: true, say: L(ctx, `I can't read the battery on this device. You're ${online ? 'online' : 'offline'}.`, `Is device pe battery nahi dikh rahi. Internet ${online ? 'chalu' : 'band'} hai.`), data: { online } };
      }
      const pct = Math.round(b.level * 100);
      return {
        ok: true,
        say: L(ctx, `Battery is at ${pct} percent${b.charging ? ' and charging' : ''}.`, `Battery ${pct} percent hai${b.charging ? ', charge ho rahi hai' : ''}.`),
        data: { battery_percent: pct, charging: b.charging, online },
      };
    },
  },
  {
    name: 'flashlight',
    description: 'Turn the torch on or off.',
    parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    async run(args, ctx) {
      const on = args.on !== false;
      try {
        await ctx.platform.torch(on);
        return { ok: true, say: on ? L(ctx, 'Torch on.', 'Torch chalu.') : L(ctx, 'Torch off.', 'Torch band.'), data: { torch: on } };
      } catch {
        return fail(ctx, "This device won't let me control the torch.", 'Is device pe torch control nahi ho rahi.', { error: 'torch_unsupported' });
      }
    },
  },
];
