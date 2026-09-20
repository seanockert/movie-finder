// Checks the filter logic against a synthetic catalogue. It needs no API key,
// no network and no data/movies.json. Run it after you change a threshold.
//
//   npm run test-filters

import { buildQuestions, findNumbers } from './lib/questions.js';
import { buildPlan, applyPlan, shortlist, describePlan } from './lib/filter.js';
import { GENRES, PROVIDER_KEYS, REGION_KEYS, REGION_COUNTRIES } from './lib/catalog.js';
import { VIBES, VIBE_KEYS } from './lib/vibes.js';
import { buildPeopleIndex, findPeople } from './lib/people.js';
import { ageTier } from './lib/certificates.js';

// Synthetic catalogue: 400 films over genres, years, ratings and services.
const movies = Array.from({ length: 400 }, (_, i) => ({
  id: i,
  t: `Film ${i}`,
  y: 1950 + (i * 7) % 76,
  g: [i % GENRES.length, (i * 3) % GENRES.length],
  rt: 80 + (i * 13) % 100,
  v: 2000 + i * 900,
  r: 5 + ((i * 37) % 50) / 10,
  s: i % 3 === 0 ? [PROVIDER_KEYS[i % PROVIDER_KEYS.length]] : [],
  o: 'A film about things happening to people.',
  tag: '',
  p: '/x.jpg',
  c: REGION_COUNTRIES[i % REGION_COUNTRIES.length],
  l: i % 4 ? 'en' : 'ko',
  vb: VIBE_KEYS.map((_, k) => ((i * 7 + k * 13) % 41)),
  d: [['James Cameron', 'Ridley Scott', 'Cameron Crowe', 'Jane Campion'][i % 4]],
  ca: [['Russell Crowe', 'Cate Blanchett', 'Denzel Washington'][i % 3], 'Extra Person'],
  kw: i % 5 === 0 ? ['heist', 'christmas'] : ['time travel'],
  k: i % 7 === 0 ? null : i % 5,               // certificate tier 0..4
  col: i % 3 === 0 ? `Series ${i % 11}` : null,
}));
const PEOPLE = buildPeopleIndex(movies);
const votes = movies.map((m) => m.v).sort((a, b) => a - b);
const STATS = { famous: votes[Math.floor(votes.length * 0.75)], obscure: votes[Math.floor(votes.length * 0.45)] };

// Test answers with the same shape as the answers from Jev.
function answers(over = {}, people = []) {
  const a = {};
  for (const g of GENRES) a[`g:${g}`] = { noul: 0.02 };
  for (const k of PROVIDER_KEYS) a[`s:${k}`] = { noul: 0.02 };
  for (const v of VIBES) {
    a[`v:${v.key}`] = { score: 2, confidence: 0.5, probabilities: {} };
    a[`w:${v.key}`] = { noul: 0.04 };
  }
  if (people.length) {
    a.person = {
      choice: 'none',
      confidence: 0.9,
      probabilities: Object.fromEntries([['none', 0.9], ...people.map((p) => [p.key, 0.01])]),
    };
    a.personRole = { choice: 'either', confidence: 0.5, probabilities: {} };
  }
  Object.assign(a, {
    region: { choice: 'anywhere', confidence: 0.9, probabilities: { anywhere: 0.9 } },
    subtitled: { noul: 0.03 },
    era: { choice: 'any', confidence: 0.9, probabilities: { any: 0.9 } },
    acclaim: { noul: 0.1 }, family: { noul: 0.05 },
    runtime: { score: 2, confidence: 0.8 }, fame: { score: 2, confidence: 0.8 },
    sort: { choice: 'best', confidence: 0.8 },
  });
  return Object.assign(a, over);
}

function run(name, query, over) {
  const numbers = findNumbers(query);
  const people = findPeople(PEOPLE, query);
  const qs = buildQuestions({ numbers, people });
  const a = answers(over, people);
  const plan = buildPlan(a, people);
  const { kept, relaxed } = applyPlan(movies, plan, STATS);
  const list = shortlist(kept, plan, query, 40);
  console.log(`${name}\n  numbers=[${numbers}] questions=${Object.keys(qs).length}`);
  console.log(`  plan: ${describePlan(plan).join(' | ') || 'none'}`);
  console.log(`  kept=${kept.length} shortlist=${list.length} relaxed=[${relaxed}]`);
  return { plan, kept, list, relaxed };
}

// 1. the headline query: a named actor and a genre. A person is a hard filter
// that code never relaxes, thus the row holds only their films.
const r1 = run('denzel washington thrillers', 'Denzel Washington thrillers', {
  person: {
    choice: 'denzel washington',
    confidence: 0.9,
    probabilities: { none: 0.02, 'denzel washington': 0.95 },
  },
  personRole: { choice: 'acted', confidence: 0.8, probabilities: {} },
  'g:Thriller': { noul: 0.9 },
});
console.assert(r1.plan.person?.role === 'acted', 'FAIL role');
console.assert(r1.kept.every((m) => m.ca.includes('Denzel Washington')), 'FAIL person filter');
console.assert(!r1.relaxed.includes('person'), 'FAIL person relaxed');

// 2. two numbers in one sentence. Jev says which is which, code checks the
// range, and both bounds reach the filter.
const r2 = run('two numbers', 'sci-fi rated over 8 since 2010', {
  'g:Science Fiction': { noul: 0.93 },
  yearNumber: { choice: '2010', confidence: 0.9 }, yearOp: { choice: 'after', confidence: 0.9 },
  ratingNumber: { choice: '8', confidence: 0.9 }, ratingOp: { choice: 'atLeast', confidence: 0.9 },
});
console.assert(r2.plan.year.value === 2010 && r2.plan.year.op === 'after', 'FAIL year bound');
console.assert(r2.plan.rating.value === 8 && r2.plan.rating.from === 'stated', 'FAIL rating bound');
// The synthetic catalogue is thin at this corner, thus the year test may give
// way. Every test that is still active must hold.
console.assert(r2.kept.every((m) => m.r >= 8 && (r2.relaxed.includes('year') || m.y >= 2010)),
  'FAIL number filters');

// 2b. Jev swaps the two numbers. Code checks the range and discards both.
const r2b = run('swapped numbers (code must reject)', 'comedies rated over 7 made since 1995', {
  'g:Comedy': { noul: 0.94 },
  yearNumber: { choice: '7', confidence: 0.4 }, yearOp: { choice: 'after', confidence: 0.5 },
  ratingNumber: { choice: '1995', confidence: 0.4 }, ratingOp: { choice: 'atLeast', confidence: 0.5 },
});
console.assert(!r2b.plan.year && !r2b.plan.rating, 'FAIL range check');

// 3. impossible query relaxes instead of returning nothing
const r3 = run('impossible', 'kid safe horror westerns from the 1960s on Stan under 90 minutes', {
  'g:Horror': { noul: 0.9 }, 'g:Western': { noul: 0.88 }, 's:stan': { noul: 0.9 },
  family: { noul: 0.9 }, runtime: { score: 0.3, confidence: 0.8 },
  era: { choice: '1960s', confidence: 0.7, probabilities: { any: 0.1, '1960s': 0.8 } },
});
console.assert(r3.kept.length >= 5, 'FAIL relaxation');

// 4. no numbers -> no number questions
const r4 = run('mood query', "something to watch when I'm sad", { vibe: { noul: 0.93 } });
console.assert(!buildQuestions({}).yearNumber, 'FAIL speculative questions');

// 5. rubric edges
run('deep cut', 'a hidden gem nobody has seen', { fame: { score: 3.4, confidence: 0.7 } });
run('epic', 'a long epic', { runtime: { score: 3.6, confidence: 0.7 } });

// 6. a split era makes the window wider and selects no single decade
const r6 = run('between two decades', 'films from the late 90s or early 2000s', {
  era: { choice: '1990s', confidence: 0.5, probabilities: { any: 0.05, '1990s': 0.5, '2000s': 0.42 } },
});
console.assert(r6.plan.era.from === 1990 && r6.plan.era.to === 2009, 'FAIL era union');

// 7. an unbounded decade keeps its open end
const r7 = run('recent', 'anything from the 2020s', {
  era: { choice: '2020s', confidence: 0.8, probabilities: { any: 0.05, '2020s': 0.9 } },
});
console.assert(r7.plan.era.from === 2020 && r7.plan.era.to === null, 'FAIL open era');

// 8. code discards a number that Jev was unsure about
const r8 = run('unsure number', 'something around 2000 maybe', {
  yearNumber: { choice: '2000', confidence: 0.2 }, yearOp: { choice: 'after', confidence: 0.3 },
  ratingNumber: { choice: 'none', confidence: 0.9 }, ratingOp: { choice: 'atLeast', confidence: 0.5 },
});
console.assert(!r8.plan.year, 'FAIL confidence gate');

// 9. an unsure sort falls back to best
const r9 = run('unsure sort', 'just show me something', { sort: { choice: 'newest', confidence: 0.25 } });
console.assert(r9.plan.sort === 'best', 'FAIL sort gate');

// 10. a region filter keeps only that region's films
const r10 = run('Australian', 'australian films', {
  region: { choice: 'australia', confidence: 0.9, probabilities: { anywhere: 0.04, australia: 0.9 } },
});
console.assert(r10.kept.every((m) => ['AU', 'NZ'].includes(m.c)), 'FAIL region');

// 11. a region spread widens across both buckets
const r11 = run('Nordic or Eastern', 'bleak european cinema', {
  region: {
    choice: 'nordic',
    confidence: 0.4,
    probabilities: { anywhere: 0.05, nordic: 0.45, eastern: 0.38 },
  },
});
console.assert(r11.plan.region.countries.has('SE') && r11.plan.region.countries.has('PL'), 'FAIL region union');

// 12. "foreign language" drops English
const r12 = run('subtitles', 'world cinema with subtitles', { subtitled: { noul: 0.9 } });
console.assert(r12.kept.every((m) => m.l !== 'en'), 'FAIL language');

// 13. an axis that the request does not mention must not move the ranking
const quiet = run('no mood expressed', 'films', {});
console.assert(quiet.plan.want.axes === 0 && quiet.plan.vibe === 0, 'FAIL want floor');
console.assert(quiet.list.every((m) => m.vibeFit === null), 'FAIL neutral vibe');

// 14. a mood query ranks by distance on the axes it named
const moody = run('mood led', 'something comforting and funny for a night in', {
  'v:comfort': { score: 4, confidence: 0.7, probabilities: {} },
  'w:comfort': { noul: 0.93 },
  'v:humour': { score: 4, confidence: 0.7, probabilities: {} },
  'w:humour': { noul: 0.9 },
});
console.assert(moody.plan.want.axes === 2, 'FAIL axis count');
{
  const ci = VIBE_KEYS.indexOf('comfort');
  const hi = VIBE_KEYS.indexOf('humour');
  const near = (m) => (m.vb[ci] + m.vb[hi]) / 2;
  const top = moody.list.slice(0, 5).map(near);
  const bottom = moody.list.slice(-5).map(near);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.assert(mean(top) > mean(bottom), 'FAIL mood ranking');
  console.log(`  top-5 mean comfort+humour ${mean(top).toFixed(1)} vs bottom-5 ${mean(bottom).toFixed(1)} (of 40)`);
}

// 15. a named person becomes a hard filter that is never relaxed
{
  const people = findPeople(PEOPLE, 'russell crowe films');
  console.assert(people.some((p) => p.name === 'Russell Crowe'), 'FAIL name lookup');
  const r = run('named actor', 'russell crowe films', {
    person: {
      choice: 'russell crowe',
      confidence: 0.9,
      probabilities: { none: 0.02, 'russell crowe': 0.95 },
    },
    personRole: { choice: 'acted', confidence: 0.8, probabilities: {} },
    'g:Drama': { noul: 0.7 },
  });
  console.assert(r.plan.person?.role === 'acted', 'FAIL role');
  console.assert(r.kept.every((m) => m.ca.includes('Russell Crowe')), 'FAIL person filter');
  console.assert(!r.relaxed.includes('person'), 'FAIL person relaxed');
}

// 16. a director-only credit answers the role question without Jev
{
  const r = run('named director', 'a jane campion film', {
    person: {
      choice: 'jane campion',
      confidence: 0.9,
      probabilities: { none: 0.02, 'jane campion': 0.95 },
    },
    personRole: { choice: 'acted', confidence: 0.3, probabilities: {} },
  });
  console.assert(r.plan.person.role === 'directed', 'FAIL role override');
  console.assert(r.kept.every((m) => m.d.includes('Jane Campion')), 'FAIL director filter');
}

// 17. a person filter with too few films does not fall back to all films
{
  const one = movies[0];
  const solo = { key: 'solo person', name: 'Solo Person', dir: [one.id], act: [] };
  const plan = buildPlan(answers({
    person: { choice: 'solo person', confidence: 0.9, probabilities: { none: 0.02, 'solo person': 0.95 } },
    personRole: { choice: 'directed', confidence: 0.8, probabilities: {} },
  }, [solo]), [solo]);
  const { kept } = applyPlan(movies, plan, STATS);
  console.log(`one-film person -> kept=${kept.length}`);
  console.assert(kept.length === 1, 'FAIL sticky person filter');
}

// 18. the family filter uses a real certificate before the genre guess
{
  const r = run('for kids', 'something for my six year old', { family: { noul: 0.9 } });
  console.assert(r.kept.every((m) => (m.k === null
    ? !m.g.some((i) => ['Horror', 'War', 'Crime', 'Thriller'].includes(GENRES[i]))
    : m.k <= 1)), 'FAIL certificate filter');
  console.assert(r.kept.some((m) => m.k === 0 || m.k === 1), 'FAIL certificate used');
}

// 19. keywords are searchable, thus "heist" finds the films with that tag
{
  const r = run('keyword', 'a heist film', {});
  const top = r.list.slice(0, 10).filter((m) => m.kw.includes('heist')).length;
  console.log(`  heist-tagged in top 10: ${top}`);
  console.assert(top >= 8, 'FAIL keyword search');
}

// 20. a series cannot take more than two slots
{
  const r = run('series cap', 'films', {});
  const counts = {};
  for (const m of r.list) if (m.col) counts[m.col] = (counts[m.col] ?? 0) + 1;
  console.assert(Object.values(counts).every((n) => n <= 2), 'FAIL series cap');
}

// 21. certificates fold to one tier. The ambiguous letters need a country.
{
  const rd = (c, cert) => ({ iso_3166_1: c, release_dates: [{ certification: cert }] });
  const cases = [
    [[rd('AU', 'MA15+'), rd('US', 'R')], 3],
    [[rd('US', 'PG')], 1],
    [[rd('IN', 'A')], 4],              // India: adults only
    [[rd('MX', 'A')], 0],              // Mexico: everyone
    [[rd('DE', '16')], 3],
    [[rd('KR', '19')], 4],
    [[rd('FR', '')], null],
    [[], null],
    [[rd('IN', 'A'), rd('AU', 'G')], 0],
  ];
  for (const [results, want] of cases) {
    console.assert(ageTier(results) === want,
      `FAIL certificate ${JSON.stringify(results)} -> ${ageTier(results)}, want ${want}`);
  }
}

// 22. question shapes are valid
const qs = buildQuestions({ numbers: ['8', '2000'] });
for (const [k, v] of Object.entries(qs)) {
  if (v.type === 'choice') console.assert(Object.keys(v.criteria).length >= 2, `FAIL ${k}`);
  if (v.type === 'score') console.assert(v.criteria.length >= 2, `FAIL ${k}`);
  console.assert(typeof v.instructions === 'string' && v.instructions.length, `FAIL ${k}`);
}
console.log(`\nquestion count with two numbers: ${Object.keys(qs).length}`);
console.log('checks done');
