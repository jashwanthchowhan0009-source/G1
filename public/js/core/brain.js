// The brain: takes what the user said, decides what to do, returns what to say and show.
// With an AI connection it reasons with tools; without one it uses the built-in command understanding.

import { parseIntent, stripWake, yesNo } from './nlu.js';
import { buildSystemPrompt, forSpeech, smallTalk, greeting } from './persona.js';

const MAX_ROUNDS = 5;
const MAX_HISTORY = 24;

export function createBrain({ skills, ctx, getLLM = () => null, timeZone = '' }) {
  let history = [];
  let pending = null;
  let followUp = null; // basic mode: the request G1 just asked a question about

  const settings = () => ctx.settings.get();
  const hi = () => settings().language === 'hi-IN';

  function trim(messages) {
    let out = messages.slice(-MAX_HISTORY);
    while (out.length && out[0].role !== 'user') out = out.slice(1);
    return out;
  }

  async function runTool(name, args) {
    const skill = skills.get(name);
    if (!skill) return { ok: false, say: hi() ? 'Yeh abhi mujhse nahi hota.' : "I can't do that yet.", data: { error: 'unknown_tool', tool: name } };
    try {
      return (await skill.run(args || {}, ctx)) || { ok: true, say: '', data: {} };
    } catch (e) {
      return { ok: false, say: hi() ? 'Kuch gadbad ho gayi. Ek baar aur try karein?' : 'Something went wrong there. Try once more?', data: { error: String(e?.message || e) } };
    }
  }

  function remember(userText, reply) {
    history = trim([...history, { role: 'user', content: userText }, { role: 'assistant', content: reply.say || '' }]);
  }

  async function local(text) {
    let intent = parseIntent(text, { now: ctx.now() });
    if (followUp) {
      // "Set a timer" ... "For how long?" ... "10 minutes"
      const joined = !intent || intent.tool === 'web_lookup' ? parseIntent(`${followUp} ${text}`, { now: ctx.now() }) : null;
      if (joined) intent = joined;
      followUp = null;
    }
    if (!intent) {
      return {
        say: hi()
          ? 'Yeh samajh nahi aaya. Call, message, reminder, mausam, rasta ya gaana bolo. Khul ke baat karne ke liye settings mein AI key daal do.'
          : "I didn't get that. Try a call, message, reminder, weather, directions or music. For open conversation, add an AI key in settings.",
        source: 'local',
        understood: false,
      };
    }
    if (intent.tool === '_stop') return { say: '', source: 'local', stop: true };
    if (intent.tool === '_chat') return { say: smallTalk(intent.args.kind, settings()), source: 'local' };
    const res = await runTool(intent.tool, intent.args);
    if (res.confirm) {
      pending = res.confirm;
      return { say: res.confirm.say, card: res.confirm.card || { type: 'confirm', title: res.confirm.say }, expectReply: true, source: 'local' };
    }
    if (res.expectReply) followUp = text;
    return { say: res.say, card: res.card, expectReply: Boolean(res.expectReply), source: 'local', tool: intent.tool, ok: res.ok };
  }

  async function withModel(llm, text) {
    const system = buildSystemPrompt({ settings: settings(), memory: ctx.store.get('memory', []), now: ctx.now(), timeZone });
    const tools = skills.toolSchemas();
    const messages = [...history, { role: 'user', content: text }];
    let card = null;
    let lastSay = '';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await llm.chat({ system, messages, tools });
      messages.push(r.message);
      if (!r.toolCalls.length) {
        history = trim(messages);
        const say = forSpeech(r.text) || lastSay;
        return { say, card, expectReply: /\?\s*$/.test(say), source: 'ai' };
      }
      let confirm = null;
      for (const tc of r.toolCalls) {
        if (confirm) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'not_run', reason: 'waiting for the user to answer an earlier yes/no question' }) });
          continue;
        }
        const res = await runTool(tc.name, tc.args);
        if (res.confirm) {
          confirm = res.confirm;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'waiting_for_user_yes_or_no', asked: res.confirm.say }) });
          continue;
        }
        if (res.card) card = res.card;
        if (res.say) lastSay = res.say;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: res.ok !== false, ...(res.data || {}), spoken_summary: res.say || undefined }) });
      }
      if (confirm) {
        pending = confirm;
        messages.push({ role: 'assistant', content: confirm.say });
        history = trim(messages);
        return { say: confirm.say, card: confirm.card || { type: 'confirm', title: confirm.say }, expectReply: true, source: 'ai' };
      }
    }
    history = trim(messages);
    return { say: lastSay || (hi() ? 'Ho gaya.' : 'Done.'), card, source: 'ai' };
  }

  return {
    /** Main entry: one thing the user said. Returns { say, card, expectReply, source, stop?, notice? }. */
    async handle(raw) {
      const text = stripWake(raw).trim();
      if (!text) return { say: '', source: 'local' };

      if (pending) {
        const answer = yesNo(text);
        const action = pending;
        pending = null;
        if (answer === 'yes') {
          let res;
          try {
            res = await action.proceed();
          } catch (e) {
            res = { ok: false, say: hi() ? 'Yeh nahi ho paya.' : "That didn't go through.", data: { error: String(e?.message || e) } };
          }
          const reply = { say: res.say, card: res.card, source: 'local' };
          remember(text, reply);
          return reply;
        }
        if (answer === 'no') {
          const reply = { say: hi() ? 'Theek hai, nahi kiya.' : "Okay, I won't.", source: 'local' };
          remember(text, reply);
          return reply;
        }
        // anything else is a new request; the waiting action is dropped
      }

      if (parseIntent(text)?.tool === '_stop') return { say: '', source: 'local', stop: true };

      const llm = getLLM();
      if (llm) {
        try {
          return await withModel(llm, text);
        } catch (e) {
          const reply = await local(text);
          if (reply.understood === false) {
            reply.say = hi() ? 'AI se connect nahi ho pa raha. Basic kaam abhi bhi kar sakta hu: call, reminder, mausam.' : "I can't reach my AI brain right now. I can still do the basics: calls, reminders, weather.";
          }
          reply.notice = String(e?.message || e);
          remember(text, reply);
          return reply;
        }
      }
      const reply = await local(text);
      remember(text, reply);
      return reply;
    },

    /** Touch fallback for the yes/no card. */
    answerPending(yes) {
      return this.handle(yes ? 'yes' : 'no');
    },
    hasPending: () => Boolean(pending),
    greet: () => greeting(settings(), ctx.now()),
    reset() {
      history = [];
      pending = null;
      followUp = null;
    },
    history: () => history,
  };
}
