import { createPile } from '/pile.js';
import { POSTER } from '/catalog.js';

function $(id) {
  return document.getElementById(id);
}

const q = $('q');
const form = $('form');
const clearBtn = $('clear');
const results = $('results');
const status = $('status');
const panel = $('panel');
const panelBody = $('panelBody');

const DEBOUNCE = 1000;
const CACHE_MAX = 50;
const TILT = [-0.045, 0.03, -0.02, 0.04, -0.035];

const pile = createPile($('pile'), POSTER);
let showing = [];       // ids currently lifted out of the pile
let seq = 0;            // guards against a slow answer landing after a fast one
let inflight = null;
let lastSent = '';      // the same sentence twice is not worth two requests
const cache = new Map();

// ---- pile ----

fetch(`/api/pile?w=${Math.round(innerWidth)}`)
  .then((r) => r.json())
  .then((d) => {
    pile.drop(d.pile);
    console.log(`${d.total} films, ${d.pile.length} in the pile. Built ${d.built}.`);
  })
  .catch(() => { status.textContent = 'Could not load the pile.'; });

// ---- the placeholder types itself ----

const SUGGESTIONS = [
  'Denzel Washington thrillers',
  'a Scorsese crime film',
  "something to watch when I'm sad",
  '90s action on Netflix',
  'sci-fi rated over 8 since 2010',
  'Korean thrillers that will wreck me',
  'slow, beautiful, nothing much happens',
  'a funny film under 100 minutes on Netflix',
  'time travel films that mess with your head',
  'weird French cinema from the 60s',
  'a crowd pleaser for six people and a pizza',
  'something for my six year old on Disney+',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wait while the box has text, then continue from the same letter.
async function idle() { while (q.value) await sleep(400); }

(async function ghostType() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    q.placeholder = SUGGESTIONS[0];
    return;
  }
  for (let i = 0; ; i = (i + 1) % SUGGESTIONS.length) {
    const line = SUGGESTIONS[i];
    for (let n = 1; n <= line.length; n++) {
      await idle();
      q.placeholder = line.slice(0, n);
      await sleep(34 + Math.random() * 46);
    }
    await idle();
    await sleep(2800);
    for (let n = line.length; n >= 0; n--) {
      await idle();
      q.placeholder = line.slice(0, n);
      await sleep(15);
    }
    await sleep(340);
  }
}());

// ---- query ----

let timer;
q.addEventListener('input', () => {
  clearBtn.hidden = !q.value;
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE);
});

// Enter skips the wait.
form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(timer);
  run({ force: true });
});

clearBtn.addEventListener('click', () => {
  q.value = '';
  clearBtn.hidden = true;
  clearTimeout(timer);
  lastSent = '';
  clearAll();
  q.focus();
});

const busy = (on) => form.classList.toggle('busy', on);

async function run({ force = false } = {}) {
  const query = q.value.trim();
  if (query.length < 3) { clearAll(); return; }

  // Do not ask again for a sentence that has an answer.
  if (!force && query === lastSent) return;

  const hit = cache.get(query);
  if (hit) {
    lastSent = query;
    console.log(`"${query}" answered from cache`);
    show(hit);
    renderPanel(hit);
    return;
  }

  const mine = ++seq;
  inflight?.abort();
  inflight = new AbortController();
  status.textContent = '';
  lastSent = query;
  busy(true);

  let data;
  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: inflight.signal,
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
  } catch (err) {
    if (err.name === 'AbortError' || mine !== seq) return;
    busy(false);
    lastSent = '';            // permit a second try with the same sentence
    status.textContent = err.message;
    return;
  }
  if (mine !== seq) return;
  busy(false);

  cache.set(query, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);   // remove oldest

  show(data);
  renderPanel(data);
}

// ---- showing the picks ----

function clearAll() {
  showing.forEach((id) => pile.dropBack(id));
  showing = [];
  results.replaceChildren();
  status.textContent = '';
  panelBody.replaceChildren(el('p', { class: 'note' }, 'Type a request. Two Jev requests answer it.'));
}

// An empty box and its tooltip. The browser calculates where the poster lands.
// The poster does not enter the flow.
function slotFor(m) {
  const svc = m.services.length
    ? el('span', { class: 'svc' }, m.services.map((s) => s.label).join(' · '))
    : el('span', { class: 'svc off' }, 'Not streaming in AU');

  return el('div', { class: 'slot' }, [
    el('div', { class: 'box' }),
    el('div', { class: 'tip', role: 'tooltip' }, [
      el('b', {}, m.title),
      el('span', { class: 'facts' }, [
        `${m.year} · IMDb ${m.rating.toFixed(1)}`,
        m.runtime ? `${m.runtime} min` : null,
        m.genres.slice(0, 3).join(', '),
      ].filter(Boolean).join(' · ')),
      svc,
      el('span', { class: 'match' }, ['Jev match ', el('b', {}, pct(m.match))]),
    ]),
  ]);
}

function show(data) {
  const picks = data.picks;
  results.replaceChildren(...picks.map(slotFor));

  const keep = new Set(picks.map((m) => m.id));
  showing.filter((id) => !keep.has(id)).forEach((id) => pile.dropBack(id));
  showing = picks.map((m) => m.id);

  requestAnimationFrame(() => {
    const slots = [...results.children];
    const boxes = slots.map((s) => s.querySelector('.box').getBoundingClientRect());

    // Pull first, thus the heap falls while the posters move up.
    const taken = new Set();
    const els = picks.map((m) => pile.pluck({ id: m.id, t: m.title, p: m.poster }, taken));

    els.forEach((node, i) => {
      const m = picks[i];
      const slot = slots[i];
      const anchor = `--pick-${m.id}`;
      node.style.backgroundImage = `url("${POSTER(m.poster, 'w185')}")`;
      node.style.setProperty('anchor-name', anchor);
      slot.querySelector('.tip').style.setProperty('position-anchor', anchor);
      node.onclick = () => window.open(`https://www.imdb.com/title/${m.imdbId}/`, '_blank');
      node.onpointerenter = () => slot.classList.add('tip-on');
      node.onpointerleave = () => slot.classList.remove('tip-on');
    });

    setTimeout(() => {
      els.forEach((node, i) => pile.flyTo(node, boxes[i], TILT[i % TILT.length]));
    }, pile.YANK);
  });

  // The numbers go to the console, not to the screen.
  const c = data.cost;
  const ms = c.stage1.latencyMs + (c.stage2?.latencyMs ?? 0);
  const usd = c.stage1.costUsd + (c.stage2?.costUsd ?? 0);
  const nq = c.stage1.questions + (c.stage2?.questions ?? 0);
  console.log(`${nq} judgments · ${ms} ms · $${usd.toFixed(5)}`);
  console.log(`${data.counts.kept} films passed the filters, best ${data.counts.shortlist} ranked`);
  if (data.relaxed.length) console.log(`relaxed: ${data.relaxed.join(', ')}`);
  if (!picks.length) console.log(`Nothing cleared the bar. Best was ${pct(data.counts.best)}.`);
}

// ---- panel ----

$('toggle').addEventListener('click', () => { panel.hidden = !panel.hidden; });
$('close').addEventListener('click', () => { panel.hidden = true; });

// A missing signal must look missing, not like a number.
function pct(p) {
  return Number.isFinite(p) ? `${Math.round(p * 100)}%` : '—';
}

function bar(label, p, hot = p >= 0.5) {
  const width = Number.isFinite(p) ? Math.round(p * 100) : 0;
  return el('div', { class: 'row' }, [
    el('span', {}, label),
    el('div', { class: `bar${hot && width ? ' hot' : ''}` }, el('i', { style: `width:${width}%` })),
    el('b', {}, pct(p)),
  ]);
}

function renderPanel(d) {
  const s = d.signals;
  const out = [];

  out.push(el('h3', {}, ['Filters code applied ', el('em', {}, 'from the answers')]));
  out.push(el('div', { class: 'chips' },
    (d.plan.length ? d.plan : ['no filter — everything is a candidate']).map((t) => el('span', { class: 'chip' }, t))));
  if (d.relaxed.length) {
    out.push(el('div', { class: 'chips' },
      d.relaxed.map((t) => el('span', { class: 'chip warn' }, `relaxed: ${t}`))));
  }

  if (s.person) {
    out.push(el('h3', {}, ['Who ', el('em', {}, 'choice')]));
    out.push(el('p', { class: 'note' },
      'Code searched the catalogue for every name the sentence could mean, bare surnames '
      + 'included. Jev only picks between them, so it cannot name somebody who is not there.'));
    s.person.candidates.forEach((c) => out.push(bar(c.name, c.p, c.p >= 0.4)));
    out.push(bar('nobody', s.person.none, false));
    if (s.person.chosen) {
      out.push(el('p', { class: 'note' }, `${s.person.chosen} — ${s.person.films} films in the catalogue.`));
    }
  }

  out.push(el('h3', {}, ['Genre ', el('em', {}, 'one noul each')]));
  out.push(...s.genres.map((g) => bar(g.key, g.p, g.p >= 0.55)));

  if (s.services.some((x) => x.p > 0.05)) {
    out.push(el('h3', {}, ['Service ', el('em', {}, 'one noul each')]));
    out.push(...s.services.map((x) => bar(x.key, x.p, x.p >= 0.6)));
  }

  if (s.yearNumber || s.ratingNumber) {
    out.push(el('h3', {}, ['Which number is which ', el('em', {}, 'choice')]));
    out.push(el('p', { class: 'note' },
      'Code found the numbers in the sentence. Jev only picks between them, so it cannot invent one.'));
    if (s.yearNumber) out.push(bar(`year = ${s.yearNumber.choice} (${s.yearNumber.op})`, s.yearNumber.confidence));
    if (s.ratingNumber) out.push(bar(`rating = ${s.ratingNumber.choice} (${s.ratingNumber.op})`, s.ratingNumber.confidence));
  }

  out.push(el('h3', {}, ['Era ', el('em', {}, 'choice')]));
  out.push(el('p', { class: 'note' },
    'The year window comes from the whole spread, not just the winner. Two decades '
    + 'close together widen it rather than one of them losing.'));
  s.era.spread.forEach((x) => out.push(bar(x.key, x.p, x.p >= 0.22)));

  out.push(el('h3', {}, ['Where from ', el('em', {}, 'choice')]));
  out.push(el('p', { class: 'note' },
    'Seventeen buckets, read as a spread like the era. "Scandinavian" does not have '
    + 'to pick one country.'));
  s.region.spread.forEach((x) => out.push(bar(x.label, x.p, x.p >= 0.22)));
  if (s.subtitled >= 0.2) out.push(bar('not in English', s.subtitled, s.subtitled >= 0.6));

  out.push(el('h3', {}, ['The thirteen axes ', el('em', {}, 'score + noul each')]));
  out.push(el('p', { class: 'note' },
    'Every film in the catalogue was placed on these thirteen scales once, at build time. '
    + 'The request is placed on the same scales now. Code matches the two, so the mood '
    + 'search runs over the whole catalogue and costs nothing at request time.'));

  const spoken = s.axes.filter((x) => x.weight >= 0.45).sort((x, y) => y.weight - x.weight);
  if (!spoken.length) {
    out.push(el('p', { class: 'note' },
      'The request spoke to none of them, so the mood match is switched off and the '
      + 'sort order decides.'));
  }
  spoken.forEach((x) => out.push(bar(`${x.label} → ${x.want.toFixed(1)}/4`, x.weight)));
  if (spoken.length) {
    out.push(bar('mood pull', s.vibe));
    out.push(el('p', { class: 'note' },
      `${s.axes.length - spoken.length} axes went unmentioned and carry no weight. `
      + 'Mood pull is the mean of the rest, and decides how far the mood match '
      + 'outweighs the asked-for sort order.'));
  }

  out.push(el('h3', {}, ['Reading of the request ', el('em', {}, 'choice · score · noul')]));
  out.push(bar(`order: ${s.sort.choice}`, s.sort.confidence));
  out.push(bar(`length ${s.runtime.score.toFixed(2)}/4`, s.runtime.confidence));
  out.push(bar(`fame ${s.fame.score.toFixed(2)}/4`, s.fame.confidence));
  out.push(bar('wants acclaim', s.acclaim));
  out.push(bar('kid safe', s.family));

  out.push(el('h3', {}, ['Match ', el('em', {}, 'one noul per shortlisted film')]));
  out.push(el('p', { class: 'note' },
    `${d.counts.kept} films passed the filters. The best ${d.counts.shortlist} went to Jev in one request.`));
  out.push(...d.picks.map((m) => bar(m.title, m.match)));

  const c = d.cost;
  out.push(el('h3', {}, 'The bill'));
  out.push(el('p', { class: 'bill' }, [
    el('b', {}, `${c.stage1.questions} questions`), ` in one request, ${c.stage1.latencyMs} ms.`,
    el('br'),
    el('b', {}, `${c.stage2?.questions ?? 0} questions`), ` in one request, ${c.stage2?.latencyMs ?? 0} ms.`,
    el('br'),
    el('b', {}, `$${(c.stage1.costUsd + (c.stage2?.costUsd ?? 0)).toFixed(6)}`), ' for the whole answer.',
  ]));

  panelBody.replaceChildren(...out);
}

// ---- dom helper ----

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const kid of [kids].flat()) n.append(kid);
  return n;
}
