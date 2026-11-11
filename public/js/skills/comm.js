// People: contacts, calls, messages, email, UPI payments.

import { uid } from '../core/store.js';
import { L, ask, fail, norm } from './util.js';

const RELATIONS = [
  ['mom', 'mum', 'mummy', 'mumma', 'mother', 'maa', 'ma', 'amma', 'ammi'],
  ['dad', 'daddy', 'papa', 'father', 'nanna', 'pitaji', 'appa', 'abbu'],
  ['wife', 'biwi', 'patni'],
  ['husband', 'pati'],
  ['brother', 'bhai', 'bhaiya', 'anna', 'tammudu'],
  ['sister', 'didi', 'behen', 'akka', 'chelli'],
];

const contacts = (ctx) => ctx.store.get('contacts', []);
const digits = (s) => String(s || '').replace(/[^\d+]/g, '');
const looksLikeNumber = (s) => /^\+?[\d\s().-]{7,}$/.test(String(s).trim());

/** Phone number with country code, digits only (the form wa.me and tel: links want). */
export function intlNumber(phone, countryCode = '91') {
  let d = digits(phone);
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return countryCode + d;
  return d;
}

/** Returns { contact } | { many: [names] } | { none: true }. */
export function resolveContact(ctx, query) {
  const q = norm(query).replace(/^(my|mere|meri|mera|apne|apni)\s+/, '');
  if (!q) return { none: true };
  if (looksLikeNumber(query)) return { contact: { name: String(query).trim(), phone: digits(query), adhoc: true } };
  const list = contacts(ctx);
  const names = (c) => [c.name, ...(c.aliases || [])].map(norm);
  const exact = list.filter((c) => names(c).includes(q));
  if (exact.length === 1) return { contact: exact[0] };
  if (exact.length > 1) return { many: exact.map((c) => c.name) };
  const group = RELATIONS.find((g) => g.includes(q));
  if (group) {
    const rel = list.filter((c) => names(c).some((n) => group.includes(n)));
    if (rel.length) return { contact: rel[0] };
  }
  const partial = list.filter((c) => names(c).some((n) => n.startsWith(q) || n.split(' ').includes(q) || (q.length > 3 && n.includes(q))));
  if (partial.length === 1) return { contact: partial[0] };
  if (partial.length > 1) return { many: partial.map((c) => c.name) };
  return { none: true };
}

function needContact(ctx, query, forWhat = 'phone') {
  const r = resolveContact(ctx, query);
  if (r.many) {
    const names = r.many.slice(0, 3).join(L(ctx, ' or ', ' ya '));
    return { error: ask(ctx, `Which one, ${names}?`, `Kaun sa, ${names}?`) };
  }
  if (r.none) {
    return {
      error: fail(
        ctx,
        `I don't have ${query} saved. Tell me the number and I'll save it.`,
        `${query} mere paas saved nahi hai. Number bolo, main save kar leta hu.`,
        { error: 'contact_not_found', name: query },
      ),
    };
  }
  if (forWhat === 'phone' && !r.contact.phone) {
    return { error: fail(ctx, `${r.contact.name} has no phone number saved.`, `${r.contact.name} ka number saved nahi hai.`, { error: 'no_phone' }) };
  }
  return { contact: r.contact };
}

export const commSkills = [
  {
    name: 'add_contact',
    description: 'Save or update a contact. Use when the user gives a name with a phone number, UPI ID or email.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        upi_id: { type: 'string', description: 'UPI ID such as name@bank' },
        email: { type: 'string' },
        alias: { type: 'string', description: 'Relation or nickname, e.g. mom' },
      },
      required: ['name'],
    },
    run(args, ctx) {
      const name = String(args.name || '').trim();
      if (!name) return ask(ctx, 'What name should I save it under?', 'Kis naam se save karu?');
      if (!args.phone && !args.upi_id && !args.email) return ask(ctx, `What's ${name}'s number?`, `${name} ka number kya hai?`);
      const list = contacts(ctx);
      let c = list.find((x) => norm(x.name) === norm(name));
      if (!c) {
        c = { id: uid(), name, phone: '', upi: '', email: '', aliases: [] };
        list.push(c);
      }
      if (args.phone) c.phone = digits(args.phone);
      if (args.upi_id) c.upi = String(args.upi_id).trim().toLowerCase().replace(/\s+/g, '');
      if (args.email) c.email = String(args.email).trim();
      if (args.alias && !c.aliases.includes(norm(args.alias))) c.aliases.push(norm(args.alias));
      ctx.store.set('contacts', list);
      return {
        ok: true,
        say: L(ctx, `Saved ${c.name}.`, `${c.name} save ho gaya.`),
        data: { saved: c.name, phone: c.phone, upi_id: c.upi, email: c.email },
        card: { type: 'list', title: c.name, items: [c.phone, c.upi, c.email].filter(Boolean) },
      };
    },
  },
  {
    name: 'find_contact',
    description: "Look up a saved contact's phone number, UPI ID or email. Leave name empty to list all contacts.",
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    run(args, ctx) {
      const list = contacts(ctx);
      if (!args.name) {
        if (!list.length) return fail(ctx, 'No contacts saved yet.', 'Abhi koi contact saved nahi hai.', { contacts: [] });
        const names = list.map((c) => c.name);
        return {
          ok: true,
          say: L(ctx, `You have ${names.length} contacts: ${names.slice(0, 6).join(', ')}.`, `${names.length} contacts hain: ${names.slice(0, 6).join(', ')}.`),
          data: { contacts: list.map(({ name, phone, upi, email }) => ({ name, phone, upi_id: upi, email })) },
          card: { type: 'list', title: L(ctx, 'Contacts', 'Contacts'), items: names.slice(0, 5), more: Math.max(0, names.length - 5) },
        };
      }
      const r = needContact(ctx, args.name, 'any');
      if (r.error) return r.error;
      const c = r.contact;
      const spoken = c.phone ? c.phone.replace(/\D/g, '').split('').join(' ') : '';
      return {
        ok: true,
        say: c.phone ? L(ctx, `${c.name}'s number is ${spoken}.`, `${c.name} ka number hai ${spoken}.`) : L(ctx, `I have ${c.name} but no number.`, `${c.name} hai, par number nahi hai.`),
        data: { name: c.name, phone: c.phone, upi_id: c.upi, email: c.email },
        card: { type: 'list', title: c.name, items: [c.phone, c.upi, c.email].filter(Boolean) },
      };
    },
  },
  {
    name: 'delete_contact',
    description: 'Delete a saved contact.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run(args, ctx) {
      const r = needContact(ctx, args.name, 'any');
      if (r.error) return r.error;
      const c = r.contact;
      return {
        confirm: {
          say: L(ctx, `Delete ${c.name} from contacts?`, `${c.name} ko contacts se hata du?`),
          proceed: () => {
            ctx.store.set('contacts', contacts(ctx).filter((x) => x.id !== c.id));
            return { ok: true, say: L(ctx, `Deleted ${c.name}.`, `${c.name} hata diya.`), data: { deleted: c.name } };
          },
        },
      };
    },
  },
  {
    name: 'call_contact',
    description: 'Start a phone call to a saved contact or a phone number.',
    parameters: { type: 'object', properties: { to: { type: 'string', description: 'Contact name or phone number' } }, required: ['to'] },
    run(args, ctx) {
      if (!args.to) return ask(ctx, 'Who should I call?', 'Kisko call karu?');
      const r = needContact(ctx, args.to);
      if (r.error) return r.error;
      const c = r.contact;
      const url = 'tel:+' + intlNumber(c.phone, ctx.settings.get().countryCode);
      const direct = ctx.platform.open(url);
      return {
        ok: true,
        say: direct === 'placed' ? L(ctx, `Calling ${c.name}.`, `${c.name} ko call laga raha hu.`) : L(ctx, `Calling ${c.name}. Tap call if it asks.`, `${c.name} ko call laga raha hu. Poochhe toh call daba dena.`),
        data: { calling: c.name, phone: c.phone },
        card: { type: 'action', title: c.name, text: c.phone, label: L(ctx, 'Start call', 'Call karo'), url },
      };
    },
  },
  {
    name: 'send_message',
    description: 'Send a WhatsApp message or SMS to a saved contact or number. The device reads it back and asks the user to confirm.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Contact name or phone number' },
        text: { type: 'string', description: 'The message, in the words the user wants sent' },
        channel: { type: 'string', enum: ['whatsapp', 'sms'] },
      },
      required: ['to', 'text'],
    },
    run(args, ctx) {
      if (!args.to) return ask(ctx, 'Who is it for?', 'Kisko bhejna hai?');
      const r = needContact(ctx, args.to);
      if (r.error) return r.error;
      const c = r.contact;
      const text = String(args.text || '').trim();
      if (!text) return ask(ctx, `What should I tell ${c.name}?`, `${c.name} ko kya bolu?`);
      const channel = args.channel === 'sms' ? 'sms' : 'whatsapp';
      const number = intlNumber(c.phone, ctx.settings.get().countryCode);
      const url = channel === 'sms' ? `sms:+${number}?&body=${encodeURIComponent(text)}` : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
      const app = channel === 'sms' ? 'SMS' : 'WhatsApp';
      return {
        confirm: {
          say: L(ctx, `${app} to ${c.name}: "${text}". Send it?`, `${c.name} ko ${app}: "${text}". Bhej du?`),
          card: { type: 'confirm', title: `${app} to ${c.name}`, text },
          proceed: async () => {
            // With G1 Core: SMS goes out through G1's own SIM, WhatsApp through G1's business number. No tap needed.
            const viaCore = channel === 'sms' ? ctx.core?.can('sim') : ctx.core?.can('whatsapp_api');
            if (viaCore) {
              try {
                const r = await ctx.core.run(channel === 'sms' ? 'send_sms' : 'send_whatsapp', { to: number, message: text }, true);
                if (r.ok && !r.open_url) return { ok: true, say: L(ctx, 'Sent.', 'Bhej diya.'), data: { channel, to: c.name, text, route: r.route } };
              } catch {
                /* fall back to opening the app */
              }
            }
            const direct = ctx.platform.open(url);
            return {
              ok: true,
              say: direct === 'placed' ? L(ctx, 'Sent.', 'Bhej diya.') : L(ctx, `It's ready in ${app}. Tap send.`, `${app} mein ready hai. Send daba do.`),
              data: { channel, to: c.name, text },
              card: { type: 'action', title: `${app} to ${c.name}`, text, label: L(ctx, `Open ${app}`, `${app} kholo`), url },
            };
          },
        },
      };
    },
  },
  {
    name: 'send_email',
    description: 'Write an email to a saved contact or an email address. The device asks the user to confirm.',
    parameters: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'body'],
    },
    run(args, ctx) {
      let address = String(args.to || '').trim();
      let name = address;
      if (!/@/.test(address)) {
        const r = needContact(ctx, address, 'any');
        if (r.error) return r.error;
        if (!r.contact.email) return fail(ctx, `I don't have an email for ${r.contact.name}.`, `${r.contact.name} ka email mere paas nahi hai.`, { error: 'no_email' });
        address = r.contact.email;
        name = r.contact.name;
      }
      const subject = String(args.subject || '').trim();
      const body = String(args.body || '').trim();
      if (!body) return ask(ctx, 'What should the email say?', 'Email mein kya likhu?');
      const url = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return {
        confirm: {
          say: L(ctx, `Email to ${name}${subject ? ` about ${subject}` : ''}: "${body}". Send it?`, `${name} ko email: "${body}". Bhej du?`),
          card: { type: 'confirm', title: `Email to ${name}`, text: body },
          proceed: () => {
            ctx.platform.open(url);
            return {
              ok: true,
              say: L(ctx, "It's ready in your mail app. Tap send.", 'Mail app mein ready hai. Send daba do.'),
              data: { to: address, subject, body },
              card: { type: 'action', title: `Email to ${name}`, text: body, label: L(ctx, 'Open mail', 'Mail kholo'), url },
            };
          },
        },
      };
    },
  },
  {
    name: 'pay_upi',
    description: 'Start a UPI payment to a saved contact (with a UPI ID) or a UPI ID. Opens the UPI app; the user approves with their PIN there.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Contact name or UPI ID' },
        amount: { type: 'number', description: 'Amount in rupees' },
        note: { type: 'string' },
      },
      required: ['to', 'amount'],
    },
    run(args, ctx) {
      const amount = Number(args.amount);
      if (!args.to) return ask(ctx, 'Who do you want to pay?', 'Kisko paise bhejne hain?');
      if (!(amount > 0)) return ask(ctx, 'How much?', 'Kitne rupaye?');
      let vpa = String(args.to).trim().toLowerCase();
      let name = vpa;
      if (!/^[\w.-]+@[\w.-]+$/.test(vpa)) {
        const r = needContact(ctx, args.to, 'any');
        if (r.error) return r.error;
        if (!r.contact.upi) {
          return fail(ctx, `I don't have a UPI ID for ${r.contact.name}. Tell me their UPI ID and I'll save it.`, `${r.contact.name} ki UPI ID mere paas nahi hai. UPI ID bolo, save kar leta hu.`, { error: 'no_upi_id' });
        }
        vpa = r.contact.upi;
        name = r.contact.name;
      }
      const rupees = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
      const url = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&am=${rupees}&cu=INR${args.note ? '&tn=' + encodeURIComponent(args.note) : ''}`;
      return {
        confirm: {
          say: L(ctx, `Pay ${rupees} rupees to ${name}?`, `${name} ko ${rupees} rupaye bhejne hain?`),
          card: { type: 'confirm', title: `₹${rupees} to ${name}`, text: vpa },
          proceed: () => {
            ctx.platform.open(url);
            return {
              ok: true,
              say: L(ctx, 'Your UPI app is open. Check the name and enter your PIN to pay.', 'UPI app khul gaya. Naam check karke PIN daal do.'),
              data: { to: name, upi_id: vpa, amount, status: 'opened_upi_app_waiting_for_pin' },
              card: { type: 'action', title: `₹${rupees} to ${name}`, text: vpa, label: L(ctx, 'Open UPI app', 'UPI app kholo'), url },
            };
          },
        },
      };
    },
  },
];
