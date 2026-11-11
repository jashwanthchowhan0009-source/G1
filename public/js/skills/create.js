// Making things: short videos, and posting them. These run on G1 Core.

import { L, ask, fail } from './util.js';

const needCore = (ctx) =>
  fail(
    ctx,
    'Making videos needs G1 Core, which runs on the Dev Kit or your computer. Start it and open G1 from there.',
    'Video banane ke liye G1 Core chahiye, jo Dev Kit ya computer pe chalta hai. Use chalu karke wahin se G1 kholo.',
    { error: 'core_not_connected' },
  );

function draftScenes(topic) {
  return [`Let's talk about ${topic}.`, `Here is the one thing most people miss about ${topic}.`, 'Start small, stay consistent, and keep learning.', 'Follow for more. Made with G1.'];
}

export const createSkills_ = [
  {
    name: 'share',
    description: 'Share or post text through another app: Instagram, Facebook, WhatsApp status, or any app from the share sheet. The device asks the user to confirm, and the user finishes the post inside that app.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'What to share' }, app: { type: 'string', enum: ['instagram', 'facebook', 'whatsapp', 'any'] } },
      required: ['text'],
    },
    run(args, ctx) {
      const text = String(args.text || '').trim();
      if (!text) return ask(ctx, 'What should I share?', 'Kya share karna hai?');
      const app = ['instagram', 'facebook', 'whatsapp'].includes(args.app) ? args.app : '';
      const where = app ? app.replace(/^\w/, (c) => c.toUpperCase()) : L(ctx, 'another app', 'doosre app');
      return {
        confirm: {
          say: L(ctx, `Share "${text}" on ${where}?`, `"${text}" ${where} pe share karu?`),
          card: { type: 'confirm', title: L(ctx, `Share on ${where}`, `${where} pe share`), text },
          proceed: () => {
            const result = ctx.platform.share?.(text, app) || 'blocked';
            if (result === 'opened') return { ok: true, say: L(ctx, `${where} is open with it. Finish the post there.`, `${where} khul gaya. Wahan post poora kar do.`), data: { shared_to: app || 'share sheet' } };
            if (result === 'needs-tap') return { ok: true, say: L(ctx, 'Tap share to pick the app.', 'App chunne ke liye share dabao.'), data: { needs_tap: true }, card: { type: 'share', title: L(ctx, 'Share', 'Share'), text, label: L(ctx, 'Share', 'Share karo') } };
            return fail(ctx, "This device can't share from here. Install the G1 Android app.", 'Yahan se share nahi ho sakta. G1 Android app install karo.', { error: 'share_unavailable' });
          },
        },
      };
    },
  },
  {
    name: 'make_video',
    description: 'Make a short vertical video (Reels/Shorts) with voice-over. Write 3 to 6 short scenes yourself, one sentence each, then call this.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        scenes: { type: 'array', items: { type: 'string' }, description: 'One short sentence per scene' },
        language: { type: 'string', enum: ['english', 'hindi', 'telugu', 'tamil'] },
      },
      required: ['title', 'scenes'],
    },
    async run(args, ctx) {
      const title = String(args.title || args.topic || '').trim();
      if (!title) return ask(ctx, 'A video about what?', 'Kis cheez pe video banau?');
      if (!ctx.core?.available()) return needCore(ctx);
      const scenes = Array.isArray(args.scenes) && args.scenes.length ? args.scenes : draftScenes(title);
      let res;
      try {
        res = await ctx.core.run('create_video', { title: title.replace(/^\w/, (c) => c.toUpperCase()), scenes, language: args.language || 'english' });
      } catch (e) {
        return fail(ctx, "I couldn't reach G1 Core to make the video.", 'Video banane ke liye G1 Core tak nahi pahunch paya.', { error: String(e.message || e) });
      }
      if (!res.ok) return fail(ctx, "The video didn't render.", 'Video nahi ban paya.', { error: res.error });
      ctx.store.set('lastVideo', { id: res.video_id, file: res.file, title });
      return {
        ok: true,
        say: L(ctx, `Your video is ready, ${res.scenes} scenes. Want me to post it?`, `Video ready hai, ${res.scenes} scenes. Post kar du?`),
        data: { video_id: res.video_id, scenes: res.scenes },
        card: { type: 'video', src: res.file, title },
        expectReply: true,
      };
    },
  },
  {
    name: 'post_video',
    description: "Post the most recent video G1 made to the user's YouTube as a Short. The device asks the user to confirm.",
    parameters: {
      type: 'object',
      properties: { caption: { type: 'string' }, visibility: { type: 'string', enum: ['public', 'unlisted', 'private'] } },
    },
    run(args, ctx) {
      const last = ctx.store.get('lastVideo', null);
      if (!last) return fail(ctx, "There's no video yet. Say: make a video about something.", 'Abhi koi video nahi hai. Bolo: kisi cheez pe video banao.', { error: 'no_video' });
      if (!ctx.core?.available()) return needCore(ctx);
      const caption = String(args.caption || last.title).trim();
      const visibility = args.visibility || 'private';
      return {
        confirm: {
          say: L(ctx, `Post "${caption}" to YouTube as ${visibility}?`, `"${caption}" YouTube pe ${visibility} post kar du?`),
          card: { type: 'confirm', title: L(ctx, 'Post to YouTube', 'YouTube pe post'), text: `${caption} (${visibility})` },
          proceed: async () => {
            let res;
            try {
              res = await ctx.core.run('post_video', { video_id: last.id, caption, visibility }, true);
            } catch (e) {
              return fail(ctx, "I couldn't reach G1 Core to post it.", 'Post karne ke liye G1 Core tak nahi pahunch paya.', { error: String(e.message || e) });
            }
            if (!res.ok) {
              const notConnected = /not connected/i.test(res.error || '');
              return fail(
                ctx,
                notConnected ? 'YouTube is not connected yet. Add the YouTube keys on G1 Core, then say post it again.' : `It didn't post: ${res.error}`,
                notConnected ? 'YouTube abhi connect nahi hai. G1 Core pe YouTube keys daal do, phir bolo post karo.' : `Post nahi hua: ${res.error}`,
                { error: res.error },
              );
            }
            return {
              ok: true,
              say: L(ctx, `Posted as ${res.visibility}.`, `Post ho gaya, ${res.visibility}.`),
              data: { url: res.url, visibility: res.visibility },
              card: { type: 'action', title: caption, label: L(ctx, 'Open on YouTube', 'YouTube pe dekho'), url: res.url },
            };
          },
        },
      };
    },
  },
];
