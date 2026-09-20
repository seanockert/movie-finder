// Turns stage-one answers into a filter plan, then applies the plan in code.
// Each threshold here belongs to the application, not to the model. Change a
// number in this file and no Jev request runs again.

import { GENRES, PROVIDERS, ERAS, REGIONS, REGION_KEYS } from './catalog.js';
import { VIBES, unpackVibes, vibeMatch } from './vibes.js';
import { roleOf, filmsOf } from './people.js';

const GENRE_MIN = 0.55;
const SERVICE_MIN = 0.6;
const ACCLAIM_MIN = 0.6;
const ACCLAIM_RATING = 7.5;
const FAMILY_MIN = 0.65;
const RUBRIC_EDGE = 0.7;   // distance from the centre for a Score to count
const MAX_GENRES = 3;
const ERA_MIN_P = 0.22;      // a decade must only be a real candidate
const ERA_ANY_MAX = 0.4;     // mass on "any" = no period was named
const NUMBER_MIN_CONF = 0.35;
const SORT_MIN_CONF = 0.4;
const REGION_MIN_P = 0.22;
const REGION_ANY_MAX = 0.45;
const SUBTITLED_MIN = 0.6;
// An axis that the request does not mention must not change the ranking.
const WANT_FLOOR = 0.45;
const VIBE_PULL = 0.75;     // effect of a strong mood on the sort order
const KEYWORD_PULL = 0.3;
const PERSON_MIN_P = 0.4;
const FAMILY_MAX_TIER = 1;   // G and PG
const MAX_PER_COLLECTION = 2;
const SHORT_MAX = 105;
const LONG_MIN = 140;

const KID_SAFE = new Set(['Animation', 'Family', 'Adventure', 'Fantasy', 'Comedy', 'Music']);
const KID_UNSAFE = new Set(['Horror', 'War', 'Crime', 'Thriller']);

// Each Noul above `min`, strongest first.
function over(answers, prefix, min) {
  return Object.entries(answers)
    .filter(([k, v]) => k.startsWith(prefix) && v.noul >= min)
    .map(([k, v]) => ({ key: k.slice(prefix.length), p: v.noul }))
    .sort((x, y) => y.p - x.p);
}

// Code checks the range of each number that Jev selects. A year cannot be 8 and
// a rating cannot be 2000, thus an error cannot reach the filter. Code discards
// a selection that Jev is unsure of.
function numberInRange(answers, key, lo, hi) {
  const ans = answers[key];
  if (!ans || ans.choice === 'none' || ans.confidence < NUMBER_MIN_CONF) return null;
  const n = Number(ans.choice);
  return n >= lo && n <= hi ? n : null;
}

// Who the request is about, if anybody. Code already limited the list to names
// in the catalogue. This reads which one Jev selected, but only if Jev was
// sufficiently sure.
function personFrom(a, people) {
  if (!a.person || a.person.choice === 'none') return null;
  const entry = people.find((p) => p.key === a.person.choice);
  if (!entry || a.person.probabilities[entry.key] < PERSON_MIN_P) return null;

  // If they did only one of the two jobs, the catalogue answers the role
  // question and code ignores the guess from Jev.
  const role = roleOf(entry, a.personRole.choice);
  return {
    key: entry.key,
    name: entry.name,
    role,
    confidence: a.person.confidence,
    films: filmsOf(entry, role),
  };
}

// Read as a distribution, as eras are. "Scandinavian" need not select one
// country. A request between two regions makes the set wider.
function regionFrom(ans) {
  const p = ans.probabilities;
  if ((p.anywhere ?? 0) >= REGION_ANY_MAX) return null;

  const hit = REGION_KEYS.filter((k) => k !== 'anywhere' && p[k] >= REGION_MIN_P);
  if (!hit.length) return null;

  return {
    key: hit.join(' + '),
    label: hit.map((k) => REGIONS[k].label).join(' and '),
    countries: new Set(hit.flatMap((k) => REGIONS[k].c)),
  };
}

// The position that the request wants on each of the thirteen axes, and how
// much it says about each one. The weights are the important part: an axis that
// nobody mentions also gets a target, and code must ignore it.
function wantFrom(a) {
  const targets = VIBES.map((v) => a[`v:${v.key}`].score);
  const weights = VIBES.map((v) => a[`w:${v.key}`].noul);
  const spoken = weights.filter((w) => w >= WANT_FLOOR);
  return {
    targets,
    weights,
    floor: WANT_FLOOR,
    axes: spoken.length,
    // How much mood controls the request. Balances vibe against the sort.
    strength: spoken.length ? spoken.reduce((x, y) => x + y, 0) / spoken.length : 0,
  };
}

// Read the full era distribution, not only the winner. A request between two
// decades makes the window wider. It does not select one decade.
function eraFrom(ans) {
  const p = ans.probabilities;
  if ((p.any ?? 0) >= ERA_ANY_MAX) return null;

  const hit = Object.keys(ERAS).filter((k) => k !== 'any' && p[k] >= ERA_MIN_P);
  if (!hit.length) return null;

  const bounds = hit.map((k) => ERAS[k]);
  return {
    key: hit.join(' + '),
    label: bounds.map((e) => e.label).join(' and '),
    // A null bound has no limit, thus it wins against any number.
    from: bounds.some((e) => e.from === null) ? null : Math.min(...bounds.map((e) => e.from)),
    to: bounds.some((e) => e.to === null) ? null : Math.max(...bounds.map((e) => e.to)),
  };
}

// A Score runs 0 to 4, with 2 as neutral. Only a clear lean counts.
function lean(value) {
  if (value <= 2 - RUBRIC_EDGE) return 'low';
  if (value >= 2 + RUBRIC_EDGE) return 'high';
  return null;
}

function runtimeFrom(scoreValue) {
  switch (lean(scoreValue)) {
    case 'low': return { max: SHORT_MAX };
    case 'high': return { min: LONG_MIN };
    default: return null;
  }
}

function fameFrom(scoreValue) {
  switch (lean(scoreValue)) {
    case 'low': return { want: 'famous' };
    case 'high': return { want: 'obscure' };
    default: return null;
  }
}

function ratingFrom(answers, value) {
  if (value !== null) return { op: answers.ratingOp.choice, value, from: 'stated' };
  if (answers.acclaim.noul >= ACCLAIM_MIN) return { op: 'atLeast', value: ACCLAIM_RATING, from: 'acclaim' };
  return null;
}

export function buildPlan(a, people = []) {
  const yearValue = numberInRange(a, 'yearNumber', 1880, 2100);
  const ratingValue = numberInRange(a, 'ratingNumber', 0, 10);
  const want = wantFrom(a);

  return {
    want,
    vibe: want.strength,
    person: personFrom(a, people),
    region: regionFrom(a.region),
    subtitled: a.subtitled.noul >= SUBTITLED_MIN,
    genres: over(a, 'g:', GENRE_MIN).slice(0, MAX_GENRES),
    services: over(a, 's:', SERVICE_MIN),
    era: eraFrom(a.era),
    year: yearValue === null ? null : { op: a.yearOp.choice, value: yearValue },
    rating: ratingFrom(a, ratingValue),
    runtime: runtimeFrom(a.runtime.score),
    fame: fameFrom(a.fame.score),
    family: a.family.noul >= FAMILY_MIN,
    sort: a.sort.confidence >= SORT_MIN_CONF ? a.sort.choice : 'best',
  };
}

const IN_YEAR = {
  before: (y, value) => y <= value,
  exactly: (y, value) => y === value,
  after: (y, value) => y >= value,
};

// Each test has a name, thus the UI can say which test code dropped.
function tests(plan, stats) {
  const t = [];
  const add = (name, fn) => t.push({ name, fn });

  if (plan.fame) {
    const famous = plan.fame.want === 'famous';
    add('fame', (m) => (famous ? m.v >= stats.famous : m.v <= stats.obscure));
  }
  if (plan.runtime) {
    // max and min never occur together. An unknown runtime fails in both cases.
    const { min, max } = plan.runtime;
    add('runtime', (m) => Boolean(m.rt) && (max ? m.rt <= max : m.rt >= min));
  }
  if (plan.family) {
    // A real certificate is better than a guess from genres. The genre
    // heuristic is only for films that TMDB has no rating for.
    add('family', (m) => (m.k === null || m.k === undefined
      ? m.g.some((i) => KID_SAFE.has(GENRES[i])) && !m.g.some((i) => KID_UNSAFE.has(GENRES[i]))
      : m.k <= FAMILY_MAX_TIER));
  }
  if (plan.era) {
    const { from, to } = plan.era;
    add('era', (m) => (from === null || m.y >= from) && (to === null || m.y <= to));
  }
  if (plan.year) {
    const { op, value } = plan.year;
    const inYear = IN_YEAR[op] ?? IN_YEAR.after;
    add('year', (m) => inYear(m.y, value));
  }
  if (plan.rating) {
    const { op, value, from } = plan.rating;
    // An implied floor ("the best dramas") gives way before a stated one.
    add(from === 'acclaim' ? 'acclaim' : 'rating',
      (m) => (op === 'atMost' ? m.r <= value : m.r >= value));
  }
  if (plan.genres.length) {
    const want = plan.genres.map((g) => GENRES.indexOf(g.key));
    add('genre', (m) => want.every((i) => m.g.includes(i)));
    add('genre-any', (m) => want.some((i) => m.g.includes(i)));
  }
  if (plan.person) {
    // Never relaxed. If a person asks for Russell Crowe and there are three
    // films, three is the correct answer.
    add('person', (m) => plan.person.films.has(m.id));
  }
  if (plan.subtitled) {
    add('language', (m) => m.l !== 'en');
  }
  if (plan.region) {
    add('region', (m) => plan.region.countries.has(m.c));
  }
  if (plan.services.length) {
    const want = plan.services.map((s) => s.key);
    add('service', (m) => want.some((k) => m.s.includes(k)));
  }
  return t;
}

// Softest test first. The two genre tests are alternatives. The strict test
// gives way to the loose test before code drops genre completely.
const RELAX_ORDER = ['fame', 'runtime', 'acclaim', 'family', 'genre-any', 'era', 'year',
  'rating', 'genre', 'language', 'region', 'service'];

// A query that is too narrow returns nothing. Drop the softest test, try again,
// and tell the UI which test went.
export function applyPlan(movies, plan, stats, floor = 5) {
  const all = tests(plan, stats);
  const looseGenre = all.find((t) => t.name === 'genre-any');
  let active = all.filter((t) => t.name !== 'genre-any');   // held in reserve
  const relaxed = [];

  for (;;) {
    const kept = movies.filter((m) => active.every((t) => t.fn(m)));
    if (kept.length >= floor || !active.length) return { kept, relaxed };

    // `person` is not in RELAX_ORDER, thus no test remains to give way.
    const drop = RELAX_ORDER.find((name) => active.some((t) => t.name === name));
    if (!drop) return { kept, relaxed };

    if (drop === 'genre' && looseGenre) {
      active = active.filter((t) => t.name !== 'genre').concat(looseGenre);
      relaxed.push('genre (any, not all)');
      continue;
    }
    active = active.filter((t) => t.name !== drop);
    relaxed.push(drop === 'genre-any' ? 'genre' : drop);
  }
}

const STOP = new Set(('a an and are as at be but by film films for from have i im in is it its like me movie movies '
  + 'my of on or something that the their them then there these they this to want watch with you').split(' '));

// Cheap keyword pass. It makes the shortlist wider for mood queries, where the
// hard filters remove almost nothing.
function keywordScore(m, terms) {
  if (!terms.length) return 0;
  // TMDB keywords make "heist", "christmas", "time travel" and "zombie" work.
  // No Jev question is necessary, because the film already has the tag.
  const hay = `${m.t} ${m.tag} ${m.o} ${(m.kw ?? []).join(' ')}`.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits / terms.length;
}

const SORTS = {
  best: (a, b) => b.r - a.r,
  popular: (a, b) => b.v - a.v,
  newest: (a, b) => b.y - a.y,
  oldest: (a, b) => a.y - b.y,
};

// A perfect vibe match scores 1 and a random match scores near 0.6. The raw
// number thus has almost no spread. Expand the useful end.
const spread = (fit) => Math.max(0, (fit - 0.55) / 0.45);

// The shortlist that Jev grades in stage two.
//
// The build-time vectors do the work here. The mood match runs over each film
// that passed the filters, not over a keyword guess. It costs nothing at
// request time, because Jev made the judgments at build time. `VIBE_PULL`, in
// code, sets the effect of mood on the requested order.
export function shortlist(kept, plan, query, limit) {
  const terms = query.toLowerCase().match(/[a-z']{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];
  const byOrder = [...kept].sort(SORTS[plan.sort] ?? SORTS.best);
  const rank = new Map(byOrder.map((m, i) => [m.id, i / Math.max(1, byOrder.length - 1)]));
  const pull = VIBE_PULL * plan.vibe;

  return [...kept]
    .map((m) => {
      const order = 1 - rank.get(m.id);
      const fit = plan.want.axes ? vibeMatch(unpackVibes(m.vb), plan.want) : null;
      const mood = fit === null ? 0 : spread(fit);
      return {
        m,
        fit,
        s: order * (1 - pull) + mood * pull + keywordScore(m, terms) * KEYWORD_PULL,
      };
    })
    .sort((a, b) => b.s - a.s)
    .filter(capSeries())
    .slice(0, limit)
    .map((x) => ({ ...x.m, vibeFit: x.fit }));
}

// Six Marvel films is a worse answer than four good ones. Each series gets two
// slots.
function capSeries() {
  const seen = new Map();
  return ({ m }) => {
    if (!m.col) return true;
    const n = (seen.get(m.col) ?? 0) + 1;
    seen.set(m.col, n);
    return n <= MAX_PER_COLLECTION;
  };
}

const YEAR_WORD = { before: 'up to', exactly: 'in', after: 'from' };

const ROLE_WORD = { directed: 'directed by', acted: 'starring', either: 'with' };

export function describePlan(plan) {
  const bits = [];
  if (plan.person) bits.push(`${ROLE_WORD[plan.person.role]} ${plan.person.name}`);
  if (plan.genres.length) bits.push(plan.genres.map((g) => g.key).join(' + '));
  if (plan.era) bits.push(plan.era.label.toLowerCase());
  if (plan.year) {
    bits.push(`${YEAR_WORD[plan.year.op] ?? YEAR_WORD.after} ${plan.year.value}`);
  }
  if (plan.rating) {
    const sign = plan.rating.op === 'atMost' ? '≤' : '≥';
    const implied = plan.rating.from === 'acclaim' ? ' (implied)' : '';
    bits.push(`IMDb ${sign} ${plan.rating.value}${implied}`);
  }
  if (plan.runtime) bits.push(plan.runtime.max ? `under ${SHORT_MAX} min` : `over ${LONG_MIN} min`);
  if (plan.fame) bits.push(plan.fame.want);
  if (plan.family) bits.push('kid safe');
  if (plan.region) bits.push(plan.region.label.toLowerCase());
  if (plan.subtitled) bits.push('not in English');
  if (plan.want.axes) {
    bits.push(`${plan.want.axes} mood ${plan.want.axes === 1 ? 'axis' : 'axes'}`);
  }
  if (plan.services.length) bits.push(`on ${plan.services.map((s) => PROVIDERS[s.key].label).join(' or ')}`);
  return bits;
}
