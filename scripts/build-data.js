// Builds data/movies.json once.
//
//   TMDB  -> posters, genres, runtime, overview, origin, AU providers
//   IMDb  -> the official rating, from the free public dataset (no key)
//   Jev   -> thirteen vibe axes for each film, cached in data/vibes.json
//
// TMDB and IMDb join on the IMDb id that TMDB holds. At request time nothing
// uses these sources.
//
// The vibe pass is the expensive half, and you can restart it. It writes each
// vector to data/vibes.json immediately, thus a second run pays only for new
// films.

import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { TypeSafeClient, score } from '@typesafe-ai/sdk';
import {
  GENRE_KEY, GENRES, PROVIDERS, PROVIDER_KEYS, REGION_OF,
  SOURCE_COUNTRIES, SOURCE_LANGUAGES,
} from '../lib/catalog.js';
import { VIBES, VIBE_KEYS, packVibes } from '../lib/vibes.js';
import { ageTier } from '../lib/certificates.js';

const KEY = process.env.TMDB_API_KEY;
const REGION = 'AU';
const CORPUS = Number(process.env.CORPUS ?? 9000);   // above the pool: take all good films
const MIN_IMDB_VOTES = 400;    // low enough to keep foreign cinema
const VIBE_CACHE = new URL('../data/vibes.json', import.meta.url);
const MODEL = 'jev-1.13.0';

if (!KEY) {
  console.error('Missing TMDB_API_KEY. Add it to .env, then run npm run build-data.');
  process.exit(1);
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error('Missing TYPESAFE_API_KEY. The vibe pass needs it.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 404) return null;
    throw new Error(`TMDB ${res.status} on ${path}`);
  }
  throw new Error(`TMDB gave up on ${path}`);
}

// Run `work` over `items` with a fixed number of workers.
async function pool(items, limit, work) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  }));
  return out;
}

// Discover has a limit of 500 pages for each query, and each query prefers the
// popular films in it. Thus the build runs many narrow queries in place of one
// wide query: by decade, by country and by language. This is the only way to
// get Australian and non-English cinema into the corpus.
function discoverPasses() {
  const passes = [];
  const pages = (n, params) => {
    for (let p = 1; p <= n; p++) passes.push({ ...params, page: p });
  };

  pages(200, { sort_by: 'vote_count.desc' });
  pages(60, { sort_by: 'vote_average.desc', 'vote_count.gte': 2500 });

  for (let d = 1930; d <= 2020; d += 10) {
    pages(10, {
      sort_by: 'vote_count.desc',
      'primary_release_date.gte': `${d}-01-01`,
      'primary_release_date.lte': `${d + 9}-12-31`,
    });
  }

  // The 2020s pass is six pages for a full decade, and a 2026 film has had no
  // time to collect votes. Give the recent years their own passes.
  for (let y = 2018; y <= new Date().getFullYear(); y++) {
    pages(6, { sort_by: 'vote_count.desc', primary_release_year: y });
  }

  // Only the countries in SOURCE_COUNTRIES get their own pass. Other countries
  // can still reach the corpus through the global and decade passes, but only
  // if they are popular enough.
  for (const [code, depth] of Object.entries(SOURCE_COUNTRIES)) {
    pages(depth, { sort_by: 'vote_count.desc', with_origin_country: code });
  }

  // These countries also get an acclaim pass, which finds the good films that
  // sold few tickets.
  for (const code of ['AU', 'NZ', 'GB', 'JP', 'KR']) {
    pages(6, { sort_by: 'vote_average.desc', 'vote_count.gte': 50, with_origin_country: code });
  }

  for (const lang of SOURCE_LANGUAGES) {
    pages(12, { sort_by: 'vote_count.desc', with_original_language: lang });
    // A sort by popularity in a language returns the blockbusters of that
    // country. This pass finds the other films.
    pages(8, { sort_by: 'vote_average.desc', 'vote_count.gte': 100, with_original_language: lang });
  }

  return passes;
}

async function collectIds() {
  const ids = new Set();
  const passes = discoverPasses();
  let done = 0;

  console.log(`Listing candidates over ${passes.length} discover pages...`);
  await pool(passes, 10, async (params) => {
    const page = await tmdb('/discover/movie', { include_adult: false, ...params });
    page?.results?.forEach((m) => m.poster_path && ids.add(m.id));
    if (++done % 50 === 0) process.stdout.write(`  ${done}/${passes.length} pages, ${ids.size} films\r`);
  });
  console.log(`\n${ids.size} candidate films.`);
  return [...ids];
}

// One call for each film returns the detail and the providers together.
async function fetchDetails(ids) {
  let done = 0;
  const rows = await pool(ids, 16, async (id) => {
    const d = await tmdb(`/movie/${id}`, {
      append_to_response: 'watch/providers,credits,keywords,release_dates',
    });
    if (++done % 100 === 0) process.stdout.write(`  ${done}/${ids.length}\r`);
    if (!d?.imdb_id || !d.poster_path || !d.release_date) return null;

    const flat = d['watch/providers']?.results?.[REGION]?.flatrate ?? [];
    const providers = PROVIDER_KEYS.filter((k) =>
      flat.some((p) => PROVIDERS[k].match.test(p.provider_name)));

    return {
      imdb: d.imdb_id,
      t: d.title,
      y: Number(d.release_date.slice(0, 4)),
      g: d.genres.map((x) => GENRE_KEY[x.name]).filter((n) => n !== undefined),
      rt: d.runtime || 0,
      pop: d.vote_count,
      p: d.poster_path,
      s: providers,
      o: (d.overview ?? '').slice(0, 600),
      tag: d.tagline ?? '',
      c: d.origin_country?.[0] ?? d.production_countries?.[0]?.iso_3166_1 ?? '',
      l: d.original_language ?? '',
      // Credits, keywords and certificates come with the detail call, thus
      // they cost no extra request.
      d: (d.credits?.crew ?? []).filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 3),
      ca: (d.credits?.cast ?? []).slice(0, 6).map((p) => p.name),
      kw: (d.keywords?.keywords ?? d.keywords?.results ?? []).map((k) => k.name).slice(0, 14),
      k: ageTier(d.release_dates?.results, REGION),
      col: d.belongs_to_collection?.name ?? null,
    };
  });
  console.log(`\nFetched ${rows.filter(Boolean).length} details.`);
  return rows.filter(Boolean);
}

// title.ratings.tsv.gz is about 9 MB and needs no key. Stream it. Do not buffer
// it.
async function imdbRatings(wanted) {
  console.log('Downloading IMDb ratings...');
  const res = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz');
  if (!res.ok) throw new Error(`IMDb dataset ${res.status}`);

  const lines = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const map = new Map();
  for await (const line of lines) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const [rating, votes] = line.slice(tab + 1).split('\t');
    map.set(id, { r: Number(rating), v: Number(votes) });
  }
  console.log(`Matched ${map.size} IMDb ratings.`);
  return map;
}

// A global sort by popularity removes each foreign film, because they all have
// fewer votes than a Marvel film. Take films from each region in turn instead.
// Thus each part of the world puts its most popular titles in first.
function selectCorpus(rows, limit) {
  const buckets = new Map();
  for (const r of rows) {
    const key = REGION_OF[r.c] ?? 'other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.pop - a.pop);

  // Hollywood still gets the largest share, because people know these films.
  const DRAW = { america: 5, britain: 3, australia: 3, other: 1 };
  const draw = (key) => DRAW[key] ?? 1;
  const picked = [];
  const cursor = new Map([...buckets.keys()].map((k) => [k, 0]));

  while (picked.length < limit) {
    let moved = false;
    for (const [key, list] of buckets) {
      for (let n = 0; n < draw(key) && picked.length < limit; n++) {
        const i = cursor.get(key);
        if (i >= list.length) break;
        picked.push(list[i]);
        cursor.set(key, i + 1);
        moved = true;
      }
    }
    if (!moved) break;   // every region is exhausted
  }
  return picked.sort((a, b) => b.pop - a.pop);
}

// ---- the vibe pass ----

const client = new TypeSafeClient({ defaultModel: MODEL });

// Thirteen Scores about one film, in one request. They run in parallel over the
// same state, thus the last axis is almost free.
const VIBE_QUESTIONS = Object.fromEntries(
  VIBES.map((v) => [v.key, score(`A film is described in \`movie\`. ${v.ask}`, v.levels)]),
);

// All the data that Jev gets about a film. No poster, no reviews, and no plot
// more than the synopsis. The judgment must come from this description.
const brief = (m) => ({
  title: m.t,
  year: m.y,
  genres: m.g.map((i) => GENRES[i]),
  runtimeMin: m.rt || null,
  imdbRating: m.r,
  directedBy: m.d,
  starring: m.ca.slice(0, 3),
  keywords: m.kw,
  certificate: m.k,
  tagline: m.tag || null,
  synopsis: m.o,
});

// Increase this when `brief` or the axes change. A cache built from different
// evidence is worse than no cache, because you cannot see the mix.
const VIBE_VERSION = 3;

async function loadCache() {
  try {
    const saved = JSON.parse(await readFile(VIBE_CACHE, 'utf8'));
    if (saved.version === VIBE_VERSION) return saved.vectors;
    console.log(`Vibe cache is version ${saved.version ?? 1}, this build wants `
      + `${VIBE_VERSION}. Rescoring from scratch.`);
  } catch { /* no cache yet */ }
  return {};
}

async function scoreVibes(movies) {
  const cache = await loadCache();
  const todo = movies.filter((m) => !cache[m.imdb]);
  console.log(`\nVibe pass: ${movies.length - todo.length} cached, ${todo.length} to score.`);
  if (!todo.length) return cache;

  let done = 0;
  let failed = 0;
  let tokens = 0;
  const started = Date.now();

  const save = () => writeFile(VIBE_CACHE, JSON.stringify({ version: VIBE_VERSION, vectors: cache }));

  await pool(todo, 14, async (m) => {
    try {
      const res = await client.systemOne({ state: { movie: brief(m) }, questions: VIBE_QUESTIONS });
      cache[m.imdb] = packVibes(
        Object.fromEntries(VIBE_KEYS.map((k) => [k, res.answers[k].score])),
      );
      tokens += res.usage.input_tokens;
    } catch (err) {
      failed++;
      if (failed <= 3) console.error(`\n  ${m.t}: ${err.message}`);
    }
    // Written during the run, thus you can stop and restart a long build.
    if (++done % 200 === 0 || done === todo.length) {
      await save();
      const rate = done / ((Date.now() - started) / 1000);
      process.stdout.write(`  ${done}/${todo.length} scored, ${rate.toFixed(1)}/s, `
        + `$${((tokens * 0.042) / 1e6).toFixed(3)}\r`);
    }
  });

  console.log(`\nScored ${done - failed} films${failed ? `, ${failed} failed` : ''}. `
    + `$${((tokens * 0.042) / 1e6).toFixed(3)}, ${VIBE_KEYS.length} axes each.`);
  return cache;
}

// ---- run ----

const ids = await collectIds();
const rows = await fetchDetails(ids);
const ratings = await imdbRatings(new Set(rows.map((r) => r.imdb)));

const rated = rows
  .map((r) => ({ ...r, ...(ratings.get(r.imdb) ?? {}) }))
  .filter((r) => r.r && r.v >= MIN_IMDB_VOTES && r.g.length);

// The pool is what the discover passes found. The selected set shows only the
// effect of the draw, thus report both.
function breakdown(rows, fn, limit = 20) {
  const tally = {};
  for (const r of rows) {
    const k = fn(r);
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([k, n]) => `${k} ${n}`).join(', ');
}

console.log(`\nPool: ${rated.length} films clear the quality floor.`);
console.log(`  regions: ${breakdown(rated, (r) => REGION_OF[r.c] ?? 'other')}`);
console.log(`  decades: ${breakdown(rated, (r) => `${Math.floor(r.y / 10) * 10}s`, 12)}`);
console.log(`  english: ${rated.filter((r) => r.l === 'en').length}, `
  + `other: ${rated.filter((r) => r.l !== 'en').length}`);

const votes = rated.map((r) => r.v).sort((a, b) => a - b);
const at = (q) => votes[Math.floor(votes.length * q)] ?? 0;
const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
console.log(`  IMDb votes: p10 ${k(at(0.1))}, median ${k(at(0.5))}, p90 ${k(at(0.9))}`);
console.log(`  ${at(0.1) > MIN_IMDB_VOTES * 2
  ? 'Room to go deeper: raise SOURCE_COUNTRIES depths or the global pass.'
  : 'The bottom decile is near the vote floor, so the passes are deep enough.'}`);

const chosen = selectCorpus(rated, CORPUS);
console.log(`\nCorpus: ${chosen.length} of ${rated.length}.`);
if (chosen.length > rated.length * 0.9) {
  console.log('  That is nearly the whole pool, so the per-region draw is not doing');
  console.log('  much. Fine if you want everything; lower CORPUS to make it choose.');
}

const vibes = await scoreVibes(chosen);

// A film with no vector cannot do mood matching. Leave it out. Do not score it
// as neutral. The next run includes it.
const movies = chosen
  .filter((m) => vibes[m.imdb])
  .map((m) => ({ ...m, vb: vibes[m.imdb] }));

// Sorted by fame, thus the server can take the first N for the pile. `pop` is
// complete, and no later step reads it.
movies.forEach((m, i) => { m.id = i; delete m.pop; });

await writeFile('data/movies.json', JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  region: REGION,
  axes: VIBE_KEYS,
  movies,
}));

console.log('\nWrote data/movies.json');
console.log(`  ${movies.length} films, sorted by fame`);
console.log(`  ${movies.filter((m) => m.s.length).length} with an AU subscription service`);
console.log(`  ${movies.filter((m) => m.l !== 'en').length} not in English`);
console.log(`  years ${Math.min(...movies.map((m) => m.y))}-${Math.max(...movies.map((m) => m.y))}`);
console.log(`  regions: ${breakdown(movies, (m) => REGION_OF[m.c] ?? 'other')}`);

// If TMDB changes a response shape, these values drop to near zero. The build
// then tells you, in place of making a worse catalogue.
const share = (fn) => `${Math.round((100 * movies.filter(fn).length) / movies.length)}%`;
console.log('\nField coverage');
console.log(`  director    ${share((m) => m.d.length)}   expect ~100%`);
console.log(`  cast        ${share((m) => m.ca.length)}   expect ~100%`);
console.log(`  keywords    ${share((m) => m.kw.length)}   expect ~95%`);
console.log(`  certificate ${share((m) => m.k !== null)}   expect ~95%, unrated films fall back to genre`);
console.log(`  collection  ${share((m) => m.col)}   expect ~30%, most films are not in a series`);

// A region query cannot find a film that the region buckets cannot place. Thus
// name the codes with the largest counts.
const unplaced = {};
for (const m of movies) {
  if (REGION_OF[m.c]) continue;
  const code = m.c || '(none)';
  unplaced[code] = (unplaced[code] ?? 0) + 1;
}
const worst = Object.entries(unplaced).sort((a, b) => b[1] - a[1]).slice(0, 12);
if (worst.length) {
  const total = Object.values(unplaced).reduce((a, b) => a + b, 0);
  console.log(`\nUnplaced origins: ${total} films (${Math.round((100 * total) / movies.length)}%)`);
  console.log(`  ${worst.map(([c, n]) => `${c} ${n}`).join(', ')}`);
  console.log('  Add these codes to REGIONS in lib/catalog.js to make them findable.');
}
