import { health, locked } from '../server/handlers.js';
import { liveSelfTest } from '../server/live.js';
import { createSkills } from '../public/js/skills/index.js';
import { toDeclarations } from '../public/js/voice/live.js';

export default {
  async fetch(request) {
    const res = await health(request, process.env);
    // ?live=1: can this server start a real-time voice session with all of G1's tools? (token, socket, one spoken reply)
    if (!new URL(request.url).searchParams.get('live') || !process.env.LLM_API_KEY || locked(request, process.env)) return res;
    const info = await res.json();
    let declarations = null;
    try {
      declarations = [...toDeclarations(createSkills().toolSchemas()), { name: 'end_conversation', description: 'Hang up.', parameters: { type: 'object', properties: {} } }];
    } catch (e) {
      info.liveToolsError = String(e.message || e);
    }
    info.live = await liveSelfTest(process.env, fetch, globalThis.WebSocket, declarations);
    return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
