import { health, locked } from '../server/handlers.js';
import { liveSelfTest } from '../server/live.js';

export default {
  async fetch(request) {
    const res = await health(request, process.env);
    // ?live=1: can this server start a real-time voice session? (token, socket, one spoken reply)
    if (!new URL(request.url).searchParams.get('live') || !process.env.LLM_API_KEY || locked(request, process.env)) return res;
    const info = await res.json();
    info.live = await liveSelfTest(process.env);
    return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
