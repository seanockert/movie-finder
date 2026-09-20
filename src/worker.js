// The Cloudflare Worker. The same two endpoints as server.js. All other paths
// are static assets, matched at the edge before this code runs.
//
// The Worker holds the catalogue in its bundle and parses it once for each
// isolate at start up. A query thus pays only for the two Jev calls.
import { recommend, useApiKey, CATALOG, BUILT } from '../lib/recommend.js';
import { pilePayload, cleanQuery, logResult } from '../lib/api.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (!env.TYPESAFE_API_KEY) {
      return json({ error: 'Missing TYPESAFE_API_KEY. Run: wrangler secret put TYPESAFE_API_KEY' }, 500);
    }
    useApiKey(env.TYPESAFE_API_KEY);

    try {
      if (request.method === 'GET' && url.pathname === '/api/pile') {
        const w = Number(url.searchParams.get('w'));
        return json(pilePayload(CATALOG, BUILT, w));
      }

      if (request.method === 'POST' && url.pathname === '/api/recommend') {
        const { query } = await request.json().catch(() => ({}));
        const clean = cleanQuery(query);
        if (!clean) return json({ error: 'Say a little more.' }, 400);

        const started = Date.now();
        const result = await recommend(clean);
        logResult(clean, result, Date.now() - started);
        return json(result);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err.message ?? 'Server error' }, 500);
    }
  },
};
