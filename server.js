import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pilePayload, cleanQuery, logResult } from './lib/api.js';

const PORT = Number(process.env.PORT ?? 5174);
const PUBLIC = new URL('./public/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

if (!process.env.TYPESAFE_API_KEY) {
  console.error('Missing TYPESAFE_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

// Fails early if the build step did not run.
let recommend; let CATALOG; let BUILT;
try {
  ({ recommend, CATALOG, BUILT } = await import('./lib/recommend.js'));
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT') {
    console.error('No data/movies.json. Add TMDB_API_KEY to .env, then run: npm run build-data');
    process.exit(1);
  }
  throw err;
}

// Files outside public/ that the browser needs.
const EXTRA = {
  '/catalog.js': new URL('./lib/catalog.js', import.meta.url),
  '/matter.js': new URL('./node_modules/matter-js/build/matter.min.js', import.meta.url),
};

function json(res, code, body) {
  res.writeHead(code, { 'content-type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'GET' && path === '/api/pile') {
      const w = Number(new URL(req.url, 'http://localhost').searchParams.get('w'));
      return json(res, 200, pilePayload(CATALOG, BUILT, w));
    }

    if (req.method === 'POST' && path === '/api/recommend') {
      const { query } = await readBody(req);
      const clean = cleanQuery(query);
      if (!clean) return json(res, 400, { error: 'Say a little more.' });

      const started = Date.now();
      const result = await recommend(clean);
      logResult(clean, result, Date.now() - started);
      return json(res, 200, result);
    }

    if (EXTRA[path]) {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end(await readFile(EXTRA[path]));
    }

    const file = join(PUBLIC, path === '/' ? '/index.html' : path);
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });

    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return json(res, 404, { error: 'Not found' });
    console.error(err);
    json(res, 500, { error: err.message ?? 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Movie Finder on http://127.0.0.1:${PORT}`));
