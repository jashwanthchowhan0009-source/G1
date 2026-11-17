// G1 on Telegram: the webhook that takes messages and voice notes, and the tick that runs scheduled tasks.
//
// Setup (owner): TELEGRAM_BOT_TOKEN in Vercel, Upstash Redis connected, redeploy, then open
// /api/telegram?setup=1 once. The first person to message the bot becomes its only owner
// (or set TELEGRAM_OWNER_ID). Telegram must send the secret header G1 registered; nothing else gets in.

import { createHash } from 'node:crypto';
import { runAgent, transcribe, nextRun } from './agent.js';
import { createStore, getJson, setJson } from './store.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const api = (env, method) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

export const webhookSecret = (token) => createHash('sha256').update('g1-webhook:' + token).digest('hex').slice(0, 48);

async function tg(env, fetchImpl, method, body) {
  try {
    const r = await fetchImpl(api(env, method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export async function sendText(env, fetchImpl, chatId, text) {
  const s = String(text || '').trim() || '...';
  for (let i = 0; i < s.length; i += 4000) {
    await tg(env, fetchImpl, 'sendMessage', { chat_id: chatId, text: s.slice(i, i + 4000), link_preview_options: { is_disabled: true } });
  }
}

async function voiceToText(env, fetchImpl, file) {
  if (!file?.file_id || file.file_size > 20e6) return '';
  const info = await tg(env, fetchImpl, 'getFile', { file_id: file.file_id });
  if (!info.ok || !info.result?.file_path) return '';
  try {
    const res = await fetchImpl(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`);
    if (!res.ok) return '';
    return await transcribe(env, fetchImpl, new Uint8Array(await res.arrayBuffer()), file.mime_type || 'audio/ogg');
  } catch {
    return '';
  }
}

const HELLO = (store) =>
  [
    'Hey, main G1 hu. Bol ya voice note bhej, main kaam karta hu:',
    '- "Goa mein ₹3000 ke andar achha hotel dhundo"',
    '- "Kal subah 8 baje mujhe gym ka yaad dilana"',
    '- "Har roz 9 baje sone ka rate batana"',
    '- "iPhone 16 ka price 60000 se neeche aaye toh batana"',
    store.kind === 'memory' ? '\nNote: storage abhi connected nahi hai, toh reminders aur yaaddasht kaam nahi karenge. Vercel → Storage → Upstash Redis jodo.' : '',
  ].join('\n');

export async function telegram(request, env, fetchImpl = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, 503);

  if (request.method === 'GET') {
    if (!new URL(request.url).searchParams.get('setup')) return json({ ok: true });
    const hook = `https://${request.headers.get('x-forwarded-host') || request.headers.get('host')}/api/telegram`;
    const set = await tg(env, fetchImpl, 'setWebhook', { url: hook, secret_token: webhookSecret(env.TELEGRAM_BOT_TOKEN), allowed_updates: ['message'], drop_pending_updates: true });
    const me = await tg(env, fetchImpl, 'getMe', {});
    await tg(env, fetchImpl, 'setMyCommands', { commands: [{ command: 'start', description: 'What G1 can do' }, { command: 'tasks', description: 'Upcoming reminders and checks' }, { command: 'reset', description: 'Start a fresh conversation' }] });
    return json({ ok: Boolean(set.ok), webhook: hook, bot: me.result?.username ? '@' + me.result.username : null, error: set.ok ? undefined : set.description });
  }

  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret(env.TELEGRAM_BOT_TOKEN)) return json({ error: 'forbidden' }, 403);
  const update = await request.json().catch(() => null);
  const m = update?.message;
  if (!m?.chat?.id || m.chat.type !== 'private') return json({ ok: true });

  const store = createStore(env, fetchImpl);
  const chatId = m.chat.id;
  try {
    // Telegram retries slow webhooks: handle each update once
    if (update.update_id != null && (await store.cmd('SET', 'g1:upd:' + update.update_id, '1', 'NX', 'EX', '86400')) === null) return json({ ok: true });

    let owner = env.TELEGRAM_OWNER_ID || (await store.cmd('GET', 'g1:owner'));
    if (!owner && m.from?.id) {
      await store.cmd('SET', 'g1:owner', String(m.from.id), 'NX');
      owner = await store.cmd('GET', 'g1:owner');
    }
    if (String(owner) !== String(m.from?.id)) {
      await sendText(env, fetchImpl, chatId, 'Yeh G1 kisi aur ka hai.');
      return json({ ok: true });
    }

    await tg(env, fetchImpl, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    let text = (m.text || m.caption || '').trim();
    if (!text && (m.voice || m.audio)) {
      text = await voiceToText(env, fetchImpl, m.voice || m.audio);
      if (!text) {
        await sendText(env, fetchImpl, chatId, 'Voice note samajh nahi aaya. Ek baar aur bhejo ya likh do.');
        return json({ ok: true });
      }
    }
    if (!text) {
      await sendText(env, fetchImpl, chatId, 'Abhi main text aur voice notes samajhta hu.');
      return json({ ok: true });
    }
    if (text === '/start') {
      await sendText(env, fetchImpl, chatId, HELLO(store));
      return json({ ok: true });
    }
    if (text === '/reset') {
      await store.cmd('DEL', 'g1:hist:' + chatId);
      await sendText(env, fetchImpl, chatId, 'Theek hai, nayi baat shuru.');
      return json({ ok: true });
    }
    if (text === '/tasks') text = 'Mere upcoming reminders aur checks batao.';

    const { reply } = await runAgent({ env, store, chatId, text, fetchImpl });
    await sendText(env, fetchImpl, chatId, reply);
  } catch (e) {
    console.error('telegram: failed', e);
    await sendText(env, fetchImpl, chatId, 'Kuch gadbad ho gayi. Ek minute baad phir bhejo.');
  }
  return json({ ok: true });
}

/** Runs due reminders and checks. Called every few minutes by GitHub Actions; safe for anyone to call. */
export async function tick(_request, env, fetchImpl = fetch, now = new Date()) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'not configured' }, 503);
  const store = createStore(env, fetchImpl);
  const due = (await store.cmd('ZRANGEBYSCORE', 'g1:tasks', '-inf', String(now.getTime()))) || [];
  let ran = 0;
  for (const id of due.slice(0, 5)) {
    if (Number(await store.cmd('ZREM', 'g1:tasks', id)) !== 1) continue; // another tick took it
    const t = await getJson(store, 'g1:task:' + id, null);
    if (!t) continue;
    try {
      if (t.kind === 'remind') {
        await sendText(env, fetchImpl, t.chatId, 'Reminder: ' + t.text);
      } else {
        const { reply } = await runAgent({ env, store, chatId: t.chatId, text: 'Scheduled check: ' + t.text, fetchImpl, now, scheduled: true });
        if (reply.trim() !== 'SKIP') await sendText(env, fetchImpl, t.chatId, reply);
      }
      ran++;
    } catch (e) {
      console.error('tick: task failed', id, e);
    }
    const next = nextRun(t, now);
    if (next) {
      await setJson(store, 'g1:task:' + id, { ...t, at: next });
      await store.cmd('ZADD', 'g1:tasks', next, id);
    } else {
      await store.cmd('DEL', 'g1:task:' + id);
    }
  }
  return json({ ok: true, due: due.length, ran });
}
