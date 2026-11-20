// G1 as the home screen: finds the installed app the user named ("insta", "gpay", "phone pe").

import { norm } from './util.js';

const ALIASES = {
  insta: 'instagram', ig: 'instagram', fb: 'facebook', yt: 'youtube', gpay: 'google pay', 'g pay': 'google pay',
  phonepay: 'phonepe', 'phone pe': 'phonepe', paytm: 'paytm', camera: 'camera', gallery: 'gallery', photos: 'photos',
  maps: 'maps', 'google maps': 'maps', chrome: 'chrome', settings: 'settings', calculator: 'calculator', clock: 'clock',
  'jio saavn': 'jiosaavn', saavn: 'jiosaavn', 'disney hotstar': 'hotstar', jiohotstar: 'hotstar', 'amazon prime': 'prime video', prime: 'prime video',
};

const SAME = [['google pay', 'gpay'], ['phonepe', 'phone pe'], ['youtube', 'yt']];

/** The installed app whose name best matches what was said, or null. */
export function findApp(apps, said) {
  const base = norm(said).replace(/\s+app$/, '');
  const names = new Set([base, norm(ALIASES[base] || base)]);
  for (const pair of SAME) if (pair.some((n) => names.has(n))) pair.forEach((n) => names.add(n));
  for (const want of names) {
    const hit = bestMatch(apps, want);
    if (hit) return hit;
  }
  return null;
}

function bestMatch(apps, want) {
  if (!want) return null;
  const scored = apps
    .map((a) => {
      const n = norm(a.name);
      let score = 0;
      if (n === want) score = 100;
      else if (n.startsWith(want)) score = 80;
      else if (n.split(' ').includes(want)) score = 70;
      else if (n.includes(want)) score = 60;
      else if (want.includes(n) && n.length >= 3) score = 50;
      else if (a.id.toLowerCase().includes(want.replace(/\s+/g, ''))) score = 40;
      return { a, score: score - n.length / 100 };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored[0]?.a || null;
}
