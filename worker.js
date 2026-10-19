// Cloudflare Worker: titik masuk untuk /api/* (sisanya disajikan langsung sebagai file statis, lihat wrangler.jsonc).
// Logikanya ada di functions/api/proxy.js, yang juga dipakai Cloudflare Pages Functions.
import { onRequest } from './functions/api/proxy.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/proxy') return onRequest({ request, env });
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
