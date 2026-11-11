import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseWhen, sayWhen, sayDuration } from '../public/js/core/datetime.js';
import { parseIntent, yesNo, hasWake, stripWake } from '../public/js/core/nlu.js';
import { calculate } from '../public/js/skills/life.js';
import { NOW } from './helpers.js';

const at = (d) => [d.getDate(), d.getHours(), d.getMinutes()];
const intent = (s) => parseIntent(s, { now: NOW });

test('durations', () => {
  assert.equal(parseDuration('set a timer for 10 minutes').seconds, 600);
  assert.equal(parseDuration('1 hour 30 minutes').seconds, 5400);
  assert.equal(parseDuration('1 hour and 30 minutes').seconds, 5400);
  assert.equal(parseDuration('90 seconds').seconds, 90);
  assert.equal(parseDuration('half an hour').seconds, 1800);
  assert.equal(parseDuration('paanch minute ka timer').seconds, 300);
  assert.equal(parseDuration('das minat').seconds, 600);
  assert.equal(parseDuration('an hour').seconds, 3600);
  assert.equal(parseDuration('what am i doing'), null);
  assert.equal(parseDuration('call mom'), null);
  assert.equal(sayDuration(5400), '1 hour 30 minutes');
});

test('points in time (now is Tue 10 Nov 2026, 10:00)', () => {
  assert.deepEqual(at(parseWhen('at 5 pm', NOW).date), [10, 17, 0]);
  assert.deepEqual(at(parseWhen('at 5:30 p.m.', NOW).date), [10, 17, 30]);
  assert.deepEqual(at(parseWhen('at 5', NOW).date), [10, 17, 0], 'next 5 o\'clock');
  assert.deepEqual(at(parseWhen('at 11', NOW).date), [10, 11, 0]);
  assert.deepEqual(at(parseWhen('at 9 am', NOW).date), [11, 9, 0], 'already past today, so tomorrow');
  assert.deepEqual(at(parseWhen('tomorrow at 7', NOW).date), [11, 7, 0]);
  assert.deepEqual(at(parseWhen('tomorrow at 5', NOW).date), [11, 17, 0]);
  assert.deepEqual(at(parseWhen('kal subah 7 baje', NOW).date), [11, 7, 0]);
  assert.deepEqual(at(parseWhen('aaj shaam 6 baje', NOW).date), [10, 18, 0]);
  assert.deepEqual(at(parseWhen('raat 9 baje', NOW).date), [10, 21, 0]);
  assert.deepEqual(at(parseWhen('saade 5 baje', NOW).date), [10, 17, 30]);
  assert.deepEqual(at(parseWhen('in 20 minutes', NOW).date), [10, 10, 20]);
  assert.deepEqual(at(parseWhen('10 minute baad', NOW).date), [10, 10, 10]);
  assert.deepEqual(at(parseWhen('on friday at 4 pm', NOW).date), [13, 16, 0]);
  assert.deepEqual(at(parseWhen('tomorrow', NOW).date), [11, 9, 0]);
  assert.deepEqual(at(parseWhen('at noon', NOW).date), [10, 12, 0]);
  assert.equal(parseWhen('call mom', NOW), null);
  assert.equal(parseWhen('remind me to call mom at 5 pm', NOW).rest, 'remind me to call mom');
  assert.equal(sayWhen(new Date(2026, 10, 11, 7, 0), NOW), 'tomorrow at 7 AM');
  assert.equal(sayWhen(new Date(2026, 10, 10, 17, 30), NOW, 'hi-IN'), 'aaj 5:30 PM pe');
});

test('wake word', () => {
  assert.ok(hasWake('Hey G1 what time is it'));
  assert.ok(hasWake('G one call mom'));
  assert.ok(!hasWake('what time is it'));
  assert.equal(stripWake('Hey G1, call mom'), 'call mom');
});

test('yes and no', () => {
  for (const y of ['yes', 'Haan', 'haan bhej do', 'ok', 'send it', 'theek hai', 'Sure.']) assert.equal(yesNo(y), 'yes', y);
  for (const n of ['no', 'nahi', 'mat bhejo', 'cancel', 'rehne do', "don't"]) assert.equal(yesNo(n), 'no', n);
  assert.equal(yesNo('what is the weather'), null);
});

test('maths', () => {
  assert.equal(calculate('15 percent of 2400'), 360);
  assert.equal(calculate('(120 + 80) / 4'), 50);
  assert.equal(calculate('12 times 12'), 144);
  assert.equal(calculate('100 divided by 8'), 12.5);
  assert.equal(calculate('2 ^ 10'), 1024);
  assert.equal(calculate('18% of 50000'), 9000);
  assert.throws(() => calculate('hello'));
  assert.throws(() => calculate('1 / 0'));
});

const CASES = [
  // English
  ['what time is it', 'get_time'],
  ["what's the date today", 'get_date'],
  ['set a timer for 10 minutes', 'set_timer', { seconds: 600 }],
  ['cancel the timer', 'cancel_timer'],
  ['how much time is left on the timer', 'check_timers'],
  ['wake me up at 6 am', 'set_reminder', { kind: 'alarm' }],
  ['set an alarm for 7:30 am tomorrow', 'set_reminder', { kind: 'alarm' }],
  ['remind me to call the bank at 4 pm', 'set_reminder', { kind: 'reminder', text: 'call the bank' }],
  ['remind me in 20 minutes to check the oven', 'set_reminder', { text: 'check the oven' }],
  ['what are my reminders', 'list_reminders'],
  ['call mom', 'call_contact', { to: 'mom' }],
  ['Hey G1, call Ravi Kumar', 'call_contact', { to: 'ravi kumar' }],
  ['call 98765 43210', 'call_contact', { to: '98765 43210' }],
  ['send a whatsapp to ravi saying i will be late', 'send_message', { to: 'ravi', text: 'i will be late', channel: 'whatsapp' }],
  ['text priya that the meeting is at 5', 'send_message', { to: 'priya', channel: 'sms' }],
  ['tell mom that i reached safely', 'send_message', { to: 'mom', text: 'i reached safely' }],
  ['save ravi number 9876543210', 'add_contact', { name: 'ravi', phone: '9876543210' }],
  ["what's ravi's number", 'find_contact', { name: 'ravi' }],
  ['show my contacts', 'find_contact'],
  ['pay 500 rupees to ravi for lunch', 'pay_upi', { amount: 500, to: 'ravi', note: 'lunch' }],
  ['take a note that the wifi password is on the fridge', 'add_note', { text: 'the wifi password is on the fridge' }],
  ['read my notes', 'read_notes'],
  ['add milk and eggs to my shopping list', 'list_add', { list: 'shopping', items: ['milk', 'eggs'] }],
  ["what's on my shopping list", 'list_read', { list: 'shopping' }],
  ['remove milk from my shopping list', 'list_remove', { item: 'milk' }],
  ["what's the weather in hyderabad", 'get_weather', { place: 'hyderabad', day: 'today' }],
  ['will it rain tomorrow', 'get_weather', { place: '', day: 'tomorrow' }],
  ['navigate to anantapur bus stand', 'navigate', { destination: 'anantapur bus stand' }],
  ['find a petrol pump near me', 'find_nearby', { query: 'petrol pump' }],
  ['where am i', 'where_am_i'],
  ['play arijit singh on spotify', 'play_media', { query: 'arijit singh', service: 'spotify' }],
  ['what is this', 'look'],
  ['take a photo', 'take_photo'],
  ['how much battery is left', 'device_status'],
  ['turn on the torch', 'flashlight', { on: true }],
  ['turn off the flashlight', 'flashlight', { on: false }],
  ['what is 15 percent of 2400', 'calculate'],
  ['find hotels in goa', 'travel_search', { kind: 'hotel', to: 'goa' }],
  ['book a train from anantapur to bangalore tomorrow', 'travel_search', { kind: 'train', from: 'anantapur', to: 'bangalore', date: '2026-11-11' }],
  ['open instagram', 'open_website', { site: 'instagram' }],
  ['who is sundar pichai', 'web_lookup', { query: 'sundar pichai' }],
  ['remember that my bike number is AP02 1234', 'remember'],
  ['my name is jashwanth', 'update_settings', { user_name: 'jashwanth' }],
  ['change your voice', 'update_settings', { voice: 'next' }],
  ['speak in hindi', 'update_settings', { language: 'hindi' }],
  ['stop', '_stop'],
  ['thanks', '_chat'],
  // Hinglish
  ['mummy ko call karo', 'call_contact', { to: 'mummy' }],
  ['ravi ko phone lagao', 'call_contact', { to: 'ravi' }],
  ['ravi ko whatsapp karo ki main 10 minute mein aa raha hu', 'send_message', { to: 'ravi', text: 'main 10 minute mein aa raha hu', channel: 'whatsapp' }],
  ['papa ko bolo ki khana kha liya', 'send_message', { to: 'papa', text: 'khana kha liya' }],
  ['10 minute ka timer lagao', 'set_timer', { seconds: 600 }],
  ['kal subah 6 baje alarm lagao', 'set_reminder', { kind: 'alarm' }],
  ['shaam 5 baje dawai lene ka reminder laga do', 'set_reminder', { kind: 'reminder', text: 'dawai lene' }],
  ['aaj mausam kaisa hai', 'get_weather', { place: '', day: 'today' }],
  ['hyderabad mein mausam kaisa hai', 'get_weather', { place: 'hyderabad' }],
  ['time kya hua hai', 'get_time'],
  ['ravi ko 200 rupaye bhejo', 'pay_upi', { amount: 200, to: 'ravi' }],
  ['doodh lana hai note karo', 'add_note', { text: 'doodh lana hai' }],
  ['shopping list mein chawal aur dal daal do', 'list_add', { list: 'shopping', items: ['chawal', 'dal'] }],
  ['kishore kumar ke gaane bajao', 'play_media'],
  ['railway station ka rasta batao', 'navigate', { destination: 'railway station' }],
  ['paas mein atm kahan hai', 'find_nearby', { query: 'atm' }],
  ['ye kya hai', 'look'],
  ['torch band karo', 'flashlight', { on: false }],
  ['youtube kholo', 'open_website', { site: 'youtube' }],
  ['bas', '_stop'],
];

test('commands in English and Hinglish map to the right skill', () => {
  const misses = [];
  for (const [said, tool, args] of CASES) {
    const got = intent(said);
    if (!got || got.tool !== tool) {
      misses.push(`"${said}" -> ${got ? got.tool : 'nothing'} (wanted ${tool})`);
      continue;
    }
    for (const [k, v] of Object.entries(args || {})) {
      try {
        assert.deepEqual(got.args[k], v);
      } catch {
        misses.push(`"${said}" ${k}: ${JSON.stringify(got.args[k])} (wanted ${JSON.stringify(v)})`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

test('alarm and reminder times resolve', () => {
  const a = intent('kal subah 6 baje alarm lagao');
  assert.deepEqual(at(new Date(a.args.when_iso)), [11, 6, 0]);
  const r = intent('remind me to call the bank at 4 pm');
  assert.deepEqual(at(new Date(r.args.when_iso)), [10, 16, 0]);
  const t = intent('remind me in 20 minutes to check the oven');
  assert.deepEqual(at(new Date(t.args.when_iso)), [10, 10, 20]);
});

test('unknown chatter is not forced into a command', () => {
  assert.equal(intent('i had a long day and i am tired'), null);
  assert.equal(intent(''), null);
});
