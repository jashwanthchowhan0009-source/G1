// Local G1 server: serves the app from /public and the optional /api routes.
//   node server.mjs            -> http://localhost:5173
//   LLM_API_KEY=... ELEVENLABS_API_KEY=... node server.mjs   (keys stay on this machine)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as handlers from './server/handlers.js';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);
const ROUTES = { health: handlers.health, llm: handlers.chat, speak: handlers.tts };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const init = { method: req.method, headers: req.headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
  return new Request(`http://${req.headers.host}${req.url}`, init);
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
}

export function createServer(env = process.env) {
  return http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const api = /^\/api\/(health|llm|speak)$/.exec(path);
      if (api) return await send(res, await ROUTES[api[1]](await toRequest(req), env));

      let file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = join(file, 'index.html');
      const data = await readFile(file).catch(() => null);
      if (!data) return void res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
      console.error(e);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`G1 is running at http://localhost:${PORT}`);
    console.log(`AI brain: ${process.env.LLM_API_KEY ? 'on (server key)' : 'off here; add a key in G1 settings or set LLM_API_KEY'}`);
    console.log(`Human voice: ${process.env.ELEVENLABS_API_KEY ? 'on (server key)' : 'device voice; set ELEVENLABS_API_KEY for the natural one'}`);
  });
}
