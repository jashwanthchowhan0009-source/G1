// Basic-mode understanding: turns everyday English and Hinglish commands into a skill call
// without any AI service. With an AI key the model does this instead and handles far more.

import { parseDuration, parseWhen } from './datetime.js';

const WAKE = /^(?:(?:hey|hi|ok|okay|hello|arre|are)\s+)?(?:g\s?1|g\s?one|gee\s?one|jee\s?one|ji\s?one|g-1|जी\s?वन)\b[\s,]*/i;

export function stripWake(text) {
  return String(text || '').replace(WAKE, '').trim();
}

export function hasWake(text) {
  return WAKE.test(String(text || '').trim()) || /\b(hey|ok|okay)\s+(g\s?1|g\s?one|gee\s?one|jee\s?one)\b/i.test(text);
}

function clean(raw) {
  return stripWake(raw)
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\.?/g, '$1m')
    .replace(/[“”"]/g, '')
    .replace(/[?!।]+/g, ' ')
    .replace(/(?<!\d)[.,](?!\d)/g, ' ')
    .replace(/\b(please|plz|pls|zara|jara|yaar|bhai|bro|na|just|kindly)\b/g, ' ')
    .replace(/^\s*(can you|could you|will you|would you|i want to|i want you to|i need to|i'd like to|mujhe|kya tum|kya aap)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERB_HI = '(?:karo|kar do|kardo|kar dena|kar|kijiye|karna|karna hai|lagao|laga do|lagado|laga|bhejo|bhej do|bhejdo|bhej|milao|do|dedo|de do)';

const SMALLTALK = [
  [/^(hi|hello|hey|namaste|namaskar|hii+|yo|good (morning|afternoon|evening))( there)?$/, 'hello'],
  [/^(thanks|thank you|thankyou|shukriya|dhanyavaad|thx|great|nice|good|awesome|badhiya|mast)( so much| a lot)?$/, 'thanks'],
  [/^(how are you|kaise ho|kaisa hai|kya haal hai|what'?s up|wassup|sup)$/, 'howareyou'],
  [/^(who are you|what are you|tum kaun ho|aap kaun ho|what is g1|your name|tumhara naam kya hai)$/, 'whoareyou'],
  [/^(what can you do|help|kya kar sakte ho|kya kya kar sakte ho|what all can you do|features)$/, 'help'],
  [/^(bye|goodbye|good night|gn|alvida|tata|chalo bye|see you)$/, 'bye'],
];

/**
 * Returns { tool, args } for a recognised command, or null.
 * Special tools: _stop (be quiet / cancel) and _chat (small talk, args.kind).
 */
export function parseIntent(raw, { now = new Date() } = {}) {
  const t = clean(raw);
  if (!t) return null;
  let m;

  if (/^(stop|cancel|chup|bas|ruk|ruko|quiet|shut up|never ?mind|rehne do|chhodo|chodo|band karo|enough|theek hai bas)$/.test(t)) return { tool: '_stop', args: {} };
  for (const [re, kind] of SMALLTALK) if (re.test(t)) return { tool: '_chat', args: { kind } };

  // ---- settings by voice
  if ((m = /^(?:my name is|call me|mera naam)\s+(.+?)(?:\s+hai)?$/.exec(t))) return { tool: 'update_settings', args: { user_name: m[1] } };
  if (/\b(change|switch|badal|badlo|different|another|dusri|doosri|nayi)\b.*\b(voice|awaaz|awaz)\b/.test(t)) return { tool: 'update_settings', args: { voice: 'next' } };
  if ((m = /\b(?:speak|talk|reply|bolo|baat karo|switch to)\b.*\b(hindi|english|telugu|hinglish)\b|\b(hindi|english|telugu)\s+(?:mein|me|lo)\b/.exec(t))) {
    const l = m[1] || m[2];
    return { tool: 'update_settings', args: { language: l === 'hinglish' ? 'hindi' : l } };
  }
  if (/\b(speak|talk|bolo)\b.*\b(faster|jaldi|tez)\b/.test(t)) return { tool: 'update_settings', args: { speed: 'faster' } };
  if (/\b(speak|talk|bolo)\b.*\b(slower|slowly|dheere|aaram se)\b/.test(t)) return { tool: 'update_settings', args: { speed: 'slower' } };
  if (/\bhands ?free\b/.test(t)) return { tool: 'update_settings', args: { handsfree: !/\b(off|band|stop|disable)\b/.test(t) } };

  // ---- clock
  if (/\b(what'?s the time|what is the time|what time is it|time kya|time kitna|kitne baje|time batao|current time|samay kya|time bata)\b/.test(t)) return { tool: 'get_time', args: {} };
  if (/\b(what'?s the date|what is the date|today'?s date|aaj (ki |ka )?(date|tareekh|tarikh|din)|which day|what day is|aaj kaun ?sa din)\b/.test(t)) return { tool: 'get_date', args: {} };

  // ---- timers
  if (/\btimer\b/.test(t)) {
    if (/\b(cancel|stop|band|hata|delete|remove|khatam)\b/.test(t)) return { tool: 'cancel_timer', args: {} };
    const dur = parseDuration(t);
    if (!dur && /\b(how much|kitna|remaining|left|status|bacha|check)\b/.test(t)) return { tool: 'check_timers', args: {} };
    const label = (/\bfor (?:the |my )?([a-z ]+?)$/.exec(dur ? t.slice(dur.end) : '') || [])[1] || '';
    return { tool: 'set_timer', args: { seconds: dur?.seconds, label: label.trim() } };
  }

  // ---- alarms and reminders
  if (/\b(alarm|wake me|jaga dena|jagana|utha dena|uthana)\b/.test(t)) {
    if (/\b(cancel|delete|remove|hata|band)\b/.test(t)) return { tool: 'delete_reminder', args: { query: 'alarm' } };
    const when = parseWhen(t, now);
    return { tool: 'set_reminder', args: { kind: 'alarm', text: '', when_iso: when ? when.date.toISOString() : undefined } };
  }
  if (/\b(remind|reminders?|yaad dila|yaad kara)\b/.test(t)) {
    if (/\b(delete|remove|cancel|hata|clear)\b/.test(t)) {
      const q = t.replace(/\b(delete|remove|cancel|hata do|hata|clear|the|my|reminders?|for|about|to|ka|wala|karo|do)\b/g, ' ').replace(/\s+/g, ' ').trim();
      return { tool: 'delete_reminder', args: { query: q || 'all' } };
    }
    if (/^(?:what are |list |show |read )?(?:my |mere )?reminders(?: kya hain| batao| dikhao| sunao)?$/.test(t) || /\b(what|which|kaun|kya)\b.*\breminders\b/.test(t)) return { tool: 'list_reminders', args: {} };
    const when = parseWhen(t, now);
    const body = (when ? when.rest : t)
      .replace(/^(?:set (?:a |an )?reminder|remind me|reminder|add (?:a )?reminder)\s*(?:to|for|about|that|of)?\s*/, '')
      .replace(/\s*(?:ka reminder(?: laga do| lagao| set karo)?|yaad dila(?:na| dena| do)?|ki yaad dila(?:na| dena| do)?)\s*$/, '')
      .replace(/^(?:ki|ke|that|to)\s+/, '')
      .trim();
    return { tool: 'set_reminder', args: { kind: 'reminder', text: body, when_iso: when ? when.date.toISOString() : undefined } };
  }

  // ---- payments
  if ((m = /^(?:pay|send|transfer)\s+(?:rs\.?|rupees|₹|inr)?\s*(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|rupaye|rupay|bucks|₹)?\s+to\s+(.+?)(?:\s+for\s+(.+))?$/.exec(t))) {
    return { tool: 'pay_upi', args: { amount: +m[1], to: m[2], note: m[3] || '' } };
  }
  if ((m = /^(?:pay|send)\s+(.+?)\s+(?:rs\.?|rupees|₹)?\s*(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|rupaye|bucks|₹)?(?:\s+for\s+(.+))?$/.exec(t)) && !/\b(message|whatsapp|sms|text|email|mail)\b/.test(m[1])) {
    return { tool: 'pay_upi', args: { amount: +m[2], to: m[1], note: m[3] || '' } };
  }
  if ((m = /^(.+?)\s+ko\s+(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|rupaye|rupay|rupaiye|₹)?\s+(?:bhejo|bhej do|bhejdo|de do|dedo|pay karo|pay kar do|transfer karo|transfer kar do|send karo|send kar do)$/.exec(t))) {
    return { tool: 'pay_upi', args: { amount: +m[2], to: m[1] } };
  }

  // ---- contacts
  if ((m = /^(?:add|save|create|store)\s+(?:a\s+)?(?:new\s+)?(?:contact\s+)?(.+?)(?:'s)?\s+(?:as\s+|number\s+|phone\s+|phone number\s+|with number\s+|at\s+|is\s+)*(\+?\d[\d\s-]{6,}\d)$/.exec(t))) {
    return { tool: 'add_contact', args: { name: m[1].replace(/\b(contact|number|phone)\b/g, '').trim(), phone: m[2] } };
  }
  if ((m = /^(.+?)\s+(?:ka|ki|ke)\s+(?:phone\s+)?number\s+(\+?\d[\d\s-]{6,}\d)\s+(?:hai\s+)?(?:save|store|add)\b.*$/.exec(t)) || (m = /^(.+?)\s+(?:ka|ki|ke)\s+(?:phone\s+)?number\s+(?:save|store|add)\s+\w*\s*(\+?\d[\d\s-]{6,}\d)$/.exec(t))) {
    return { tool: 'add_contact', args: { name: m[1], phone: m[2] } };
  }
  if ((m = /^(?:save|add)\s+(.+?)(?:'s)?\s+upi(?: id)?\s+(?:as\s+|is\s+)?([\w.-]+@[\w.-]+)$/.exec(t)) || (m = /^(.+?)\s+(?:ka|ki)\s+upi(?: id)?\s+([\w.-]+@[\w.-]+)\b.*$/.exec(t))) {
    return { tool: 'add_contact', args: { name: m[1], upi_id: m[2] } };
  }
  if (/^(?:list|show|read|tell me)?\s*(?:all\s+)?(?:my\s+|mere\s+)?(?:saved\s+)?contacts(?:\s+(?:dikhao|batao|sunao))?$/.test(t)) return { tool: 'find_contact', args: {} };
  if ((m = /^(?:what'?s|what is|tell me|give me)?\s*(.+?)(?:'s| ka| ki| ke)\s+(?:phone\s+|mobile\s+)?number(?:\s+(?:kya hai|batao|bata|bolo|do))?$/.exec(t))) return { tool: 'find_contact', args: { name: m[1] } };
  if ((m = /^(?:delete|remove)\s+(?:contact\s+)?(.+?)(?:\s+from (?:my )?contacts)?$/.exec(t)) && /\bcontacts?\b/.test(t)) return { tool: 'delete_contact', args: { name: m[1] } };

  // ---- calls
  if ((m = /^(?:call|phone|dial|ring)\s+(?:up\s+)?(?:to\s+)?(.+?)(?:\s+ko)?$/.exec(t)) && !/^(?:call|phone)\s+(karo|kar)/.test(t)) return { tool: 'call_contact', args: { to: m[1] } };
  if ((m = new RegExp(`^(.+?)\\s+ko\\s+(?:ek\\s+)?(?:call|phone|fone|ring)\\s*${VERB_HI}?$`).exec(t))) return { tool: 'call_contact', args: { to: m[1] } };
  if ((m = new RegExp(`^(?:call|phone)\\s+${VERB_HI}\\s+(.+?)(?:\\s+ko)?$`).exec(t))) return { tool: 'call_contact', args: { to: m[1] } };

  // ---- messages
  const channelOf = (w) => (/sms|text/.test(w) ? 'sms' : 'whatsapp');
  if ((m = /^(?:send\s+)?(?:a\s+|an\s+)?(whatsapp|message|msg|text|sms)(?:\s+message)?\s+(?:to\s+)?(.+?)\s+(?:that|saying|say|ki|ke|:)\s+(.+)$/.exec(t))) {
    return { tool: 'send_message', args: { to: m[2], text: m[3], channel: channelOf(m[1]) } };
  }
  if ((m = new RegExp(`^(.+?)\\s+ko\\s+(?:ek\\s+)?(whatsapp|message|msg|sms|text)\\s*(?:${VERB_HI}\\s*)?(?:ki|ke|that|:)?\\s*(.*)$`).exec(t))) {
    return { tool: 'send_message', args: { to: m[1], text: m[3], channel: channelOf(m[2]) } };
  }
  if ((m = /^(?:tell|inform|message|whatsapp|text|ping)\s+(.+?)\s+(?:that|ki|ke|to)\s+(.+)$/.exec(t))) return { tool: 'send_message', args: { to: m[1], text: m[2], channel: /^text/.test(t) ? 'sms' : 'whatsapp' } };
  if ((m = /^(.+?)\s+ko\s+(?:bolo|bol do|bata do|batao|keh do|kaho)\s+(?:ki|ke)?\s*(.+)$/.exec(t))) return { tool: 'send_message', args: { to: m[1], text: m[2], channel: 'whatsapp' } };
  if ((m = /^(?:send\s+)?(?:a\s+|an\s+)?(whatsapp|message|msg|text|sms)(?:\s+message)?\s+(?:to\s+)?(.+)$/.exec(t))) return { tool: 'send_message', args: { to: m[2], text: '', channel: channelOf(m[1]) } };
  if ((m = /^(?:send\s+)?(?:an?\s+)?(?:email|mail)\s+(?:to\s+)?(\S+(?:\s\S+)?)\s+(?:about|subject|saying|that|ki)\s+(.+)$/.exec(t))) return { tool: 'send_email', args: { to: m[1], subject: '', body: m[2] } };

  // ---- notes and lists
  if ((m = /^add\s+(.+?)\s+(?:to|in|on)\s+(?:my\s+|the\s+)?(.+?)\s+list$/.exec(t))) return { tool: 'list_add', args: { list: m[2], items: splitItems(m[1]) } };
  if ((m = /^(.+?)\s+list\s+(?:mein|me|main)\s+(.+?)\s+(?:add karo|add kar do|daalo|daal do|dal do|likho|likh do|jodo)$/.exec(t))) return { tool: 'list_add', args: { list: m[1], items: splitItems(m[2]) } };
  if ((m = /^remove\s+(.+?)\s+from\s+(?:my\s+|the\s+)?(.+?)\s+list$/.exec(t))) return { tool: 'list_remove', args: { list: m[2], item: m[1] } };
  if ((m = /^(?:clear|empty)\s+(?:my\s+|the\s+)?(.+?)\s+list$/.exec(t))) return { tool: 'list_remove', args: { list: m[1], item: 'all' } };
  if ((m = /^(?:what'?s on|what is on|read|show|tell me)\s+(?:my\s+|the\s+)?(.+?)\s+list$/.exec(t)) || (m = /^(?:mer[ai]\s+)?(.+?)\s+list\s+(?:sunao|batao|dikhao|padho|mein kya hai|me kya hai)$/.exec(t))) return { tool: 'list_read', args: { list: m[1] } };
  if (/\b(delete|clear|remove|hata)\b.*\bnotes?\b/.test(t)) {
    const q = t.replace(/\b(delete|clear|remove|hata do|hata|my|the|all|notes?|about|wala|karo|do|sab|saare)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return { tool: 'delete_note', args: { query: q || 'all' } };
  }
  if (/^(?:read|show|list|what are|tell me)\s+(?:me\s+)?(?:my\s+)?notes$|^(?:my|mere)\s+notes(?:\s+(?:dikhao|sunao|batao|padho))?$|^notes\s+(?:dikhao|sunao|batao|padho)$/.test(t)) return { tool: 'read_notes', args: {} };
  if ((m = /^(?:take|make|add|write|save|create)\s+(?:a\s+|down\s+a\s+)?note\s*(?:that|:|to|saying|ki|of)?\s+(.+)$/.exec(t)) || (m = /^note\s+(?:down\s+|karo\s+|kar lo\s+|kar\s+|that\s+)?(?:ki\s+)?(.+)$/.exec(t)) || (m = /^(.+?)\s+note\s+(?:karo|kar lo|kar do|kar lena)$/.exec(t))) {
    return { tool: 'add_note', args: { text: m[1] } };
  }

  // ---- memory
  if ((m = /^(?:remember|yaad rakh(?:o|na|na ki)?)\s+(?:that\s+|ki\s+)?(.+)$/.exec(t))) return { tool: 'remember', args: { fact: m[1] } };
  if (/\b(what do you (know|remember) about me|mere baare (mein|me) kya (pata|yaad)|what have i told you)\b/.test(t)) return { tool: 'recall', args: {} };
  if ((m = /^forget\s+(?:that\s+|about\s+)?(.+)$/.exec(t)) || (m = /^(.+?)\s+bhool jao$/.exec(t))) return { tool: 'forget', args: { query: m[1] } };

  // ---- weather
  if (/\b(weather|mausam|temperature|barish|baarish|rain|raining|garmi|thand|forecast|umbrella|chhata)\b/.test(t)) {
    const day = /\b(tomorrow|kal)\b/.test(t) ? 'tomorrow' : 'today';
    const core = t.replace(/\b(today|tomorrow|kal|aaj|now|right now|abhi|this week)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const place =
      (/\b(?:in|at|for|of)\s+([a-z .]+?)$/.exec(core) || [])[1] ||
      (/^([a-z .]+?)\s+(?:mein|me|ka|ki|ke)\s+(?:\w+\s+)?(?:mausam|weather|temperature|baarish|barish)/.exec(core) || [])[1] ||
      '';
    const leftover = core.replace(/\b(what|whats|what's|how|hows|how's|is|the|it|like|will|going|to|be|there|any|tell|me|check|outside|weather|mausam|temperature|forecast|barish|baarish|rain|raining|garmi|thand|umbrella|chhata|kaisa|kaisi|hai|ho|hoga|hogi|rahi|raha|kya|kitna|kitni|batao|bata|do|i|need|should|carry|an|a|ka|ki|ke|mein|me|chahiye|lena|padega)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const named = place.replace(/\b(the|weather|mausam|is|it|like)\b/g, '').trim() || (leftover.split(' ').length <= 3 ? leftover : '');
    return { tool: 'get_weather', args: { place: named, day } };
  }

  // ---- maps
  if (/\b(where am i|my location|main kahan hu|mai kahan hu|mein kahan hu|meri location|hum kahan hain)\b/.test(t)) return { tool: 'where_am_i', args: {} };
  if ((m = /^(?:navigate|directions?|take me|route|drive|go)\s+(?:me\s+)?(?:to|for|towards)\s+(.+)$/.exec(t)) || (m = /^(?:how do i get to|how to reach|how to go to|way to)\s+(.+)$/.exec(t)) || (m = /^(.+?)\s+(?:ka rasta|ka raasta|kaise jaye|kaise jau|kaise jaun|kaise jana hai|le chalo|tak le chalo|jana hai|chalo)(?:\s+(?:batao|dikhao|bata do))?$/.exec(t))) {
    return { tool: 'navigate', args: { destination: m[1] } };
  }
  if ((m = /^(?:find|search|show|look for)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|some\s+)?(?:nearest\s+|nearby\s+|closest\s+)?(.+?)\s+(?:near me|nearby|around me|around here|close by|near here)$/.exec(t)) || (m = /^(?:nearest|closest|nearby)\s+(.+)$/.exec(t)) || (m = /^(?:paas mein|paas me|paas ka|paas ki|nazdeek|najdeek|nazdeeki)\s+(.+?)(?:\s+(?:kahan hai|dhundo|batao|dikhao))?$/.exec(t)) || (m = /^(.+?)\s+(?:paas mein|paas me|nazdeek)\s+(?:kahan hai|dhundo|batao|dikhao)$/.exec(t))) {
    return { tool: 'find_nearby', args: { query: m[1] } };
  }

  // ---- camera
  if (/\b(what am i looking at|what is this|what'?s this|ye kya hai|yeh kya hai|isko dekho|look at this|dekho ye|read this|ye padho|yeh padho|describe (this|what you see)|what do you see|kya dikh raha)\b/.test(t)) return { tool: 'look', args: { question: stripWake(raw) } };
  if (/\b(take|click|capture|snap)\b.*\b(photo|picture|selfie|pic)\b|\b(photo|picture)\s+(khicho|kheecho|kheencho|lo|le lo)\b/.test(t)) return { tool: 'take_photo', args: {} };

  // ---- device
  if (/\b(battery|charge kitna|charging)\b/.test(t)) return { tool: 'device_status', args: {} };
  if (/\b(torch|flashlight|flash light)\b/.test(t)) return { tool: 'flashlight', args: { on: !/\b(off|band|bujha|bujhao)\b/.test(t) } };

  // ---- travel
  if ((m = /\b(hotel|flight|train|bus)(?:e?s)?\b/.exec(t)) && /\b(book|find|search|show|check|dekho|dhundo|chahiye|ticket|tickets|options)\b/.test(t)) {
    const kind = m[1];
    const when = parseWhen(t, now);
    const core = (when ? when.rest : t).replace(/\b(?:for\s+)?\d+\s*(?:nights?|raat|days?|din)\b/g, ' ').replace(/\b(book|find|search|show|check|me|a|an|the|some|tickets?|options|for|dekho|dhundo|chahiye|ki|ka|ke liye|ke|karo)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const fromTo = /\bfrom\s+([a-z ]+?)\s+to\s+([a-z ]+?)(?:\s+(?:hotel|flight|train|bus)s?)?$/.exec(core) || /^([a-z ]+?)\s+se\s+([a-z ]+?)(?:\s+(?:hotel|flight|train|bus)s?)?$/.exec(core);
    const toOnly = /\b(?:to|in|at)\s+([a-z ]+?)(?:\s+(?:hotel|flight|train|bus)s?)?$/.exec(core) || /^([a-z ]+?)\s+(?:mein|me)\s+(?:hotel|flight|train|bus)s?$/.exec(core);
    const to = (fromTo ? fromTo[2] : toOnly ? toOnly[1] : '').replace(/\b(hotel|flight|train|bus)s?\b/g, '').trim();
    return { tool: 'travel_search', args: { kind, from: fromTo ? fromTo[1].trim() : '', to: to.replace(/\s+for \d+ (?:nights?|raat).*$/, '').replace(/\s+\d+ (?:nights?|raat).*$/, '').trim(), date: when ? localDate(when.date) : '', nights: nightsOf(t) } };
  }

  // ---- share to other apps
  if ((m = /^(?:share|post)\s+(.+?)\s+(?:on|to|in)\s+(instagram|insta|facebook|fb|whatsapp status|whatsapp)$/.exec(t)) || (m = /^(instagram|insta|facebook|fb)\s+(?:pe|par)\s+(?:post|share)\s+(?:karo|kar do)\s*(?:ki)?\s*(.+)$/.exec(t))) {
    const first = /^(instagram|insta|facebook|fb)$/.test(m[1]);
    const app = (first ? m[1] : m[2]).replace('insta', 'instagram').replace('instagramgram', 'instagram').replace(/^fb$/, 'facebook').replace(' status', '');
    const text = first ? m[2] : m[1];
    if (!/^(it|this|that|the video|video)$/.test(text)) return { tool: 'share', args: { text, app } };
  }

  // ---- making and posting videos (G1 Core)
  if ((m = /^(?:make|create|generate)\s+(?:me\s+)?(?:a\s+|one\s+)?(?:short\s+)?(?:video|reel|short)\s+(?:about|on|for)\s+(.+)$/.exec(t)) || (m = /^(.+?)\s+(?:pe|par|ke baare mein|ke upar)\s+(?:ek\s+)?(?:video|reel)\s+(?:banao|bana do|banado|bana)$/.exec(t))) {
    return { tool: 'make_video', args: { title: m[1] } };
  }
  if (/^(?:post|upload|publish)\s+(?:it|this|that|the video|video|the reel)(?:\s+(?:on|to)\s+youtube)?$/.test(t) || /^(?:video|reel|isko|ise)\s+(?:youtube pe\s+)?(?:post|upload)\s+(?:karo|kar do|kardo)$/.test(t)) {
    return { tool: 'post_video', args: {} };
  }
  // ---- media
  const service = /\bspotify\b/.test(t) ? 'spotify' : /\byoutube music\b/.test(t) ? 'youtube_music' : /\byoutube\b/.test(t) ? 'youtube' : undefined;
  const stripService = (s) => s.replace(/\b(?:on|pe|par|in|from)\s+(?:spotify|youtube music|youtube)\b|\b(?:spotify|youtube music|youtube)\s+(?:pe|par|mein|me)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if ((m = /^(?:play|bajao|chalao|sunao|laga do|lagao|put on)\s+(.+)$/.exec(t)) || (m = /^(.+?)\s+(?:bajao|chalao|sunao|laga do|lagao|play karo|play kar do|baja do|chala do|suna do)$/.exec(t))) {
    return { tool: 'play_media', args: { query: stripService(m[1]).replace(/^(?:the\s+)?(?:song|gaana|gana)\s+/, '').replace(/\s+(?:song|gaana|gana)$/, '') || m[1], service } };
  }

  // ---- maths
  if (/\d\s*[+*/×÷^x-]\s*\d/.test(t) || (/\d/.test(t) && /\b(percent|plus|minus|times|multiplied by|divided by|into|guna|squared)\b|%/.test(t))) {
    return { tool: 'calculate', args: { expression: t.replace(/^(?:what'?s|what is|calculate|kitna hota hai)\s+/, '') } };
  }

  // ---- open a site
  if ((m = /^(?:open|launch|go to|start)\s+(.+)$/.exec(t)) || (m = /^(.+?)\s+(?:kholo|khol do|open karo|open kar do|chalu karo)$/.exec(t))) return { tool: 'open_website', args: { site: m[1] } };

  // ---- questions about the world
  if ((m = /^(?:who is|who was|who are|what is|what are|what was|what'?s|tell me about|search for|search|google|look up|define|meaning of|kaun hai|kaun tha)\s+(.+)$/.exec(t)) || (m = /^(.+?)\s+(?:kya hai|kya hota hai|kaun hai|kaun tha|ke baare mein batao|ke bare mein batao|ka matlab)$/.exec(t))) {
    return { tool: 'web_lookup', args: { query: m[1].replace(/^(?:a|an|the)\s+/, '') } };
  }

  return null;
}

const nightsOf = (t) => {
  const m = /(\d+)\s*(?:nights?|raat)/.exec(t);
  return m ? +m[1] : undefined;
};

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function splitItems(s) {
  return s
    .split(/\s*(?:,|\band\b|\baur\b)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const YES = /^(yes|yeah|yep|yup|ya|yah|haan|han|ha|haa|ji|ji haan|ok|okay|sure|do it|send|send it|bhej do|bhejo|bhejdo|kar do|kardo|karo|theek hai|thik hai|confirm|go ahead|correct|right|sahi hai|bilkul|avunu|sare|pampu|हाँ|हां|जी|ठीक है|అవును|సరే)\b/;
const NO = /^(no|nope|nah|nahi|nahin|na|mat|cancel|stop|rehne do|ruk|ruko|wait|galat|wrong|don'?t|vaddu|नहीं|मत|వద్దు)\b/;

/** 'yes' | 'no' | null for a reply to "Send it?" */
export function yesNo(raw) {
  const t = stripWake(raw).toLowerCase().replace(/[.,!?।]/g, ' ').replace(/\s+/g, ' ').trim();
  if (NO.test(t)) return 'no';
  if (YES.test(t)) return 'yes';
  return null;
}
