// Drives the real G1 screen in Chrome with a fake microphone and speaker.
//   npm run test:browser          (needs Chrome; set CHROME=/path/to/chrome if it is not found)

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import { createServer } from '../../server.mjs';

const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = createServer({});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// Fake ears and voice: window.__say("...") speaks to G1; window.__spoken collects what G1 said.
const fakes = () => {
  window.__spoken = [];
  window.__opened = [];
  window.open = (url) => (window.__opened.push(url), {});
  class FakeRecognition {
    start() {
      window.__rec = this;
      setTimeout(() => this.onstart?.(), 0);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      window.__rec = null;
      setTimeout(() => this.onend?.(), 0);
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.__say = (text) => {
    const rec = window.__rec;
    if (!rec) return false;
    const result = [{ transcript: text }];
    result.isFinal = true;
    rec.onresult?.({ resultIndex: 0, results: [result] });
    window.__rec = null;
    rec.onend?.();
    return true;
  };
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
  };
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      getVoices: () => [{ name: 'Google हिन्दी', lang: 'hi-IN' }, { name: 'Microsoft Neerja Online (Natural)', lang: 'en-IN' }, { name: 'Plain', lang: 'en-US' }],
      speak: (u) => (window.__spoken.push(u.text), setTimeout(() => u.onend?.(), 30)),
      cancel() {},
      resume() {},
    },
  });
};

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(fakes);
  await page.route('**/api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { current: { temperature_2m: 27.6, weather_code: 2, relative_humidity_2m: 60, wind_speed_10m: 9 }, daily: { weather_code: [2, 63], temperature_2m_max: [31.2, 28.4], temperature_2m_min: [19.8, 20.1], precipitation_probability_max: [10, 70] } } }),
  );
  await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Hyderabad', latitude: 17.38, longitude: 78.47 }] } }));
  await page.goto(base);
  await page.waitForSelector('html[data-ready="true"]');
  return { page, errors };
}

const said = (page) => page.locator('#said').textContent();
const idle = (page) => page.waitForFunction(() => document.getElementById('screen').dataset.state === 'idle' && !window.__busy);
async function speak(page, text) {
  await page.waitForFunction(() => Boolean(window.__rec), null, { timeout: 5000 });
  const before = await page.evaluate(() => window.__spoken.length);
  await page.evaluate((t) => window.__say(t), text);
  await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 8000 });
  await page.waitForTimeout(120);
}

// ---------------------------------------------------------------- desktop
{
  const { page, errors } = await open({ width: 1280, height: 860 });
  await page.screenshot({ path: OUT + '1-start.png' });
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__spoken.length === 1);
  assert.match(await said(page), /What do you need\?/);
  assert.match((await page.evaluate(() => window.__spoken))[0], /Good (morning|afternoon|evening)/);

  // G1 greeted with a question, so it is already listening
  await speak(page, 'save papa number 9876543210');
  assert.match(await said(page), /Saved papa/i);

  await page.click('#mic');
  await speak(page, 'Hey G1, papa ko whatsapp karo ki main 8 baje tak aa jaunga');
  assert.match(await said(page), /WhatsApp to papa: "main 8 baje tak aa jaunga"\. Send it\?/);
  assert.equal(await page.locator('#card.card-confirm .primary').count(), 1);
  await page.screenshot({ path: OUT + '2-confirm.png' });
  assert.deepEqual(await page.evaluate(() => window.__opened), [], 'nothing opens before the yes');
  await speak(page, 'haan bhej do'); // it asked, so it listens for the answer on its own
  assert.deepEqual(await page.evaluate(() => window.__opened), ['https://wa.me/919876543210?text=main%208%20baje%20tak%20aa%20jaunga']);
  assert.equal(await page.locator('#card.card-action a.primary').getAttribute('href'), 'https://wa.me/919876543210?text=main%208%20baje%20tak%20aa%20jaunga');

  await page.click('#mic');
  await speak(page, "what's the weather in hyderabad");
  assert.match(await said(page), /28 degrees and partly cloudy in Hyderabad/);
  assert.equal(await page.locator('#card.card-weather .big').textContent(), '28');
  await page.screenshot({ path: OUT + '3-weather.png' });

  await page.click('#mic');
  await speak(page, 'set a timer for 10 minutes');
  assert.match(await page.locator('#card.card-timer .big').textContent(), /^(10:00|9:5\d)$/);
  await page.screenshot({ path: OUT + '4-timer.png' });

  await page.click('#mic');
  await speak(page, 'open instagram');
  assert.match(await said(page), /Scrolling feeds isn't my thing/);

  // listening state, for the picture
  await page.click('#mic');
  await page.waitForFunction(() => document.getElementById('screen').dataset.state === 'listening');
  await page.evaluate(() => (document.getElementById('heard').textContent = 'remind me to call the bank at'));
  await page.screenshot({ path: OUT + '5-listening.png' });
  await page.evaluate(() => window.__say('remind me to call the bank at 4 pm tomorrow'));
  await page.waitForFunction(() => /remind you tomorrow at 4 PM/.test(document.getElementById('said').textContent));

  // typing works too
  await idle(page);
  await page.click('#keys');
  await page.fill('#typed', 'what is 15 percent of 2400');
  await page.press('#typed', 'Enter');
  await page.waitForFunction(() => /360/.test(document.getElementById('said').textContent));

  // settings: switch to Hindi, then G1 answers in Hinglish; change voice by voice
  await idle(page);
  await page.click('#gear');
  await page.selectOption('[name=language]', 'hi-IN');
  await page.fill('[name=userName]', 'Jashwanth');
  await page.screenshot({ path: OUT + '6-settings.png' });
  await page.click('.sheet-foot .primary');
  await page.fill('#typed', 'time kya hua hai');
  await page.press('#typed', 'Enter');
  await page.waitForFunction(() => /ho rahe hain/.test(document.getElementById('said').textContent), null, { timeout: 4000 }).catch(async (e) => { console.log('DEBUG', await page.evaluate(() => ({ said: document.getElementById('said').textContent, heard: document.getElementById('heard').textContent, state: document.getElementById('screen').dataset.state, open: document.getElementById('settings').open, rv: document.getElementById('settings').returnValue, s: localStorage.getItem('g1:settings') }))); throw e; });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('g1:settings')).userName), 'Jashwanth');

  // data survives a reload
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('g1:contacts'))[0].phone), '9876543210');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('g1:schedule')).length), 2);
  assert.deepEqual(errors, []);
  await page.close();
}

// ---------------------------------------------------------------- phone
{
  const { page, errors } = await open({ width: 390, height: 844 });
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__spoken.length === 1);
  await speak(page, "what's the weather in hyderabad");
  await page.screenshot({ path: OUT + '7-phone.png' });
  const box = await page.locator('.screen').boundingBox();
  assert.equal(Math.round(box.width), 390, 'fills the phone screen');
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1 || document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'nothing to scroll');
  assert.deepEqual(errors, []);
  await page.close();
}

// ---------------------------------------------------------------- iPhone 1 logical size
{
  const { page, errors } = await open({ width: 320, height: 480 });
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__spoken.length === 1);
  await speak(page, 'set a timer for 5 minutes');
  await page.screenshot({ path: OUT + '8-iphone1-320x480.png' });
  const fits = await page.evaluate(() => {
    const s = document.getElementById('screen').getBoundingClientRect();
    return ['mic', 'card', 'said', 'clock'].every((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
    });
  });
  assert.equal(fits, true, 'everything fits on a 320 by 480 screen');
  for (const say of ['save papa number 9876543210', 'tell papa that i am on the way']) {
    await page.fill('#typed', say).catch(async () => { await page.click('#keys'); await page.fill('#typed', say); });
    await page.press('#typed', 'Enter');
    await page.waitForFunction((t) => document.getElementById('heard').textContent === t && document.getElementById('screen').dataset.state !== 'thinking', say);
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: OUT + '9-iphone1-confirm.png' });
  const clean = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const order = ['clock', 'bloom', 'heard', 'said', 'card', 'mic'].map(r);
    return order.every((b, i) => i === 0 || b.top >= order[i - 1].bottom - 1) && r('hint').bottom <= r('screen').bottom + 1;
  });
  assert.equal(clean, true, 'no part of the 320 by 480 screen overlaps another');
  assert.deepEqual(errors, []);
  await page.close();
}

await browser.close();
server.close();
console.log('browser smoke test passed; screenshots in tests/browser/out/');
