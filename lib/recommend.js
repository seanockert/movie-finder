// Two Jev requests for each query.
//
//   1. the sentence  -> typed filters       (one request, 60 to 66 questions)
//   2. the shortlist -> one probability each (one request, one Score per film)
//
// Code does the filtering between them. Jev sees only the thirty films that
// passed, and cannot return a title that code did not give it.

import { TypeSafeClient, score } from '@typesafe-ai/sdk';
// Imported, not read from disk. A Worker has no filesystem, thus the bundler
// puts the catalogue into the deployed script.
import raw from '../data/movies.json' with { type: 'json' };
import { GENRES, PROVIDERS, REGIONS, REGION_OF } from './catalog.js';
import { VIBES, unpackVibes } from './vibes.js';
import { buildQuestions, findNumbers } from './questions.js';
import { buildPeopleIndex, findPeople } from './people.js';
import { buildPlan, applyPlan, shortlist, describePlan } from './filter.js';

// Pinned. An alias can move answers without warning.
const MODEL = 'jev-1.13.0';
const COST_PER_MTOK = 0.042;
const SHORTLIST = 30;   // the vibe pass did the wide search already
const PICKS = 5;
// The UI shows a film only if Jev puts it at "strong" or better with this
// probability. Code adds no films to fill the row.
const PICK_MIN = 0.45;

// The key comes from TYPESAFE_API_KEY in Node, and from the `env` object on
// Cloudflare, where code cannot read it at module scope. The client is built at
// first use, thus either source can arrive first.
let client = null;
let apiKey;

export function useApiKey(key) {
  if (key && key !== apiKey) {
    apiKey = key;
    client = null;
  }
}

function api() {
  client ??= new TypeSafeClient({ defaultModel: MODEL, apiKey });
  return client;
}

export const CATALOG = raw.movies;
export const BUILT = raw.built;

// Each director and cast member in the catalogue, indexed by name and by
// surname. Built once at start up. It holds some tens of thousands of entries.
const PEOPLE = buildPeopleIndex(CATALOG);

// Vote-count limits for the "famous" and "deep cut" ends of the fame rubric.
const votes = CATALOG.map((m) => m.v).sort((a, b) => a - b);

function percentile(q) {
  return votes[Math.floor(votes.length * q)];
}

const STATS = { famous: percentile(0.75), obscure: percentile(0.45) };

function meta(res, ms, questionCount) {
  return {
    questions: questionCount,
    latencyMs: ms,
    inputTokens: res.usage.input_tokens,
    costUsd: (res.usage.input_tokens * COST_PER_MTOK) / 1e6,
  };
}

// What Jev sees of a film in stage two. Sufficient to judge, and small enough
// for thirty films in one request. The vibe vector stays out on purpose: it
// came from Jev. To give a model its own earlier answer as evidence makes a
// guess look like a fact.
function summarise(m) {
  return {
    title: m.t,
    year: m.y,
    genres: m.g.map((i) => GENRES[i]),
    imdb: m.r,
    runtimeMin: m.rt || null,
    from: REGIONS[REGION_OF[m.c]]?.label ?? null,
    language: m.l,
    directedBy: m.d,
    starring: m.ca,
    streamingOn: m.s.map((k) => PROVIDERS[k].label),
    tags: (m.kw ?? []).slice(0, 8),
    // Stored long for the build and for keyword search. Cut here, because
    // thirty full synopses in one request are large.
    about: (m.o ?? '').slice(0, 320),
  };
}

// Graded ranking needs a Score, not a Noul. A yes/no question about thirty
// films that passed the filters gives a narrow band near zero. Five levels
// separate the films and give a reason.
const MATCH_LEVELS = [
  'Wrong film. It works against the request, or has nothing to do with it.',
  'Weak. It brushes the request in passing. Showing it would read as a miss.',
  'Plausible. It meets the request on paper, but nothing about it speaks to '
    + 'this particular evening.',
  'Strong. It meets the request and suits the mood and the occasion behind it.',
  'Exactly this. Of everything ever made, this is close to the film they were '
    + 'describing without naming.',
];

// One Score for each candidate. They share the same state, thus thirty
// judgments cost one request.
function rankQuestions(count) {
  const q = {};
  for (let i = 0; i < count; i++) {
    q[`m${i}`] = score(
      'A person asked for a film using the words in `request`. Every film in '
      + '`movies` already satisfies the hard conditions they gave, such as genre, '
      + 'year, rating and streaming service, so those are settled. '
      + `How well does the film in \`movies[${i}]\` answer what they were really after?`,
      MATCH_LEVELS,
    );
  }
  return q;
}

export async function recommend(query) {
  const numbers = findNumbers(query);
  const people = findPeople(PEOPLE, query);
  const questions = buildQuestions({ numbers, people });

  const t1 = Date.now();
  const stage1 = await api().systemOne({
    state: { query, numbers, today: new Date().toISOString().slice(0, 10) },
    questions,
  });
  const ms1 = Date.now() - t1;

  const a = stage1.answers;
  const plan = buildPlan(a, people);
  const { kept, relaxed } = applyPlan(CATALOG, plan, STATS);
  const candidates = shortlist(kept, plan, query, SHORTLIST);

  const base = {
    query,
    plan: describePlan(plan),
    relaxed,
    signals: signals(a, plan, people),
    counts: { catalog: CATALOG.length, kept: kept.length, shortlist: candidates.length, best: 0 },
  };
  const stage1Cost = meta(stage1, ms1, Object.keys(questions).length);

  // Nothing to rank. This occurs only if the catalogue is very small.
  if (!candidates.length) {
    return { ...base, picks: [], cost: { stage1: stage1Cost, stage2: null } };
  }

  const t2 = Date.now();
  const stage2 = await api().systemOne({
    state: { request: query, movies: candidates.map(summarise) },
    questions: rankQuestions(candidates.length),
  });
  const ms2 = Date.now() - t2;

  // `match` is the probability that the film is Strong or better. `fit` is the
  // expected level, kept for the panel.
  const ranked = candidates
    .map((m, i) => {
      const ans = stage2.answers[`m${i}`];
      return { ...m, fit: ans.score, match: ans.probabilities[3] + ans.probabilities[4] };
    })
    .sort((x, y) => y.match - x.match);

  // If no film clears the limit, an empty row is the correct answer. To fill
  // the row is what put 12% films on screen.
  const picks = ranked.filter((m) => m.match >= PICK_MIN).slice(0, PICKS);
  base.counts.best = ranked[0]?.match ?? 0;   // useful when no film clears

  return {
    ...base,
    picks: picks.map((m) => ({
      id: m.id, title: m.t, year: m.y, rating: m.r, votes: m.v, runtime: m.rt,
      genres: m.g.map((i) => GENRES[i]),
      services: m.s.map((k) => ({ key: k, label: PROVIDERS[k].label })),
      poster: m.p, overview: m.o, imdbId: m.imdb, match: m.match, fit: m.fit,
      vibeFit: m.vibeFit, vibes: unpackVibes(m.vb),
      from: REGIONS[REGION_OF[m.c]]?.label ?? null, language: m.l,
      directors: m.d ?? [], cast: (m.ca ?? []).slice(0, 3), series: m.col ?? null,
    })),
    cost: { stage1: stage1Cost, stage2: meta(stage2, ms2, candidates.length) },
  };
}

// The raw judgments, for the panel. The demo lets you see what the model said.
function signals(a, plan, people) {
  // The most probable few, for the panel. Code reads era and region as a
  // spread, not as a winner, thus both need the same view of the answer.
  function top(answer, n = 3) {
    return Object.entries(answer.probabilities)
      .sort((x, y) => y[1] - x[1])
      .slice(0, n)
      .map(([key, p]) => ({ key, p }));
  }

  function nouls(prefix, label = (k) => k) {
    return Object.entries(a)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: label(k.slice(prefix.length)), p: v.noul }))
      .sort((x, y) => y.p - x.p);
  }

  return {
    genres: nouls('g:').slice(0, 5),
    services: nouls('s:', (k) => PROVIDERS[k].label).slice(0, 4),
    era: {
      choice: a.era.choice,
      confidence: a.era.confidence,
      spread: top(a.era),
    },
    yearNumber: a.yearNumber
      ? { choice: a.yearNumber.choice, confidence: a.yearNumber.confidence, op: a.yearOp.choice }
      : null,
    ratingNumber: a.ratingNumber
      ? { choice: a.ratingNumber.choice, confidence: a.ratingNumber.confidence, op: a.ratingOp.choice }
      : null,
    runtime: { score: a.runtime.score, confidence: a.runtime.confidence },
    fame: { score: a.fame.score, confidence: a.fame.confidence },
    acclaim: a.acclaim.noul,
    family: a.family.noul,
    subtitled: a.subtitled.noul,
    sort: { choice: a.sort.choice, confidence: a.sort.confidence },
    region: {
      choice: a.region.choice,
      confidence: a.region.confidence,
      spread: top(a.region).map((x) => ({ ...x, label: REGIONS[x.key].label })),
    },
    person: people.length ? {
      candidates: people.slice(0, 5).map((p) => ({
        key: p.key,
        name: p.name,
        p: a.person.probabilities[p.key] ?? 0,
      })).sort((x, y) => y.p - x.p),
      none: a.person.probabilities.none ?? 0,
      confidence: a.person.confidence,
      chosen: plan.person ? `${plan.person.name} (${plan.person.role})` : null,
      films: plan.person ? plan.person.films.size : 0,
    } : null,
    // How much mood controls the request: the mean weight of the axes that it
    // mentions. This number sets the effect of mood on the sort order.
    vibe: plan.vibe,
    // The thirteen axes, as the request puts them. `want` is the position on
    // the scale. `weight` is whether the request mentions that axis.
    axes: VIBES.map((v) => ({
      key: v.key,
      label: v.label,
      want: a[`v:${v.key}`].score,
      weight: a[`w:${v.key}`].noul,
    })),
  };
}
