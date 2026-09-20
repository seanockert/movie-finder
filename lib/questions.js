// Stage one. One Jev request turns a sentence into typed filters.
//
// Code owns all exact work: it finds the numbers, it holds the year bounds for
// each era, and it applies the filters. Jev owns the two tasks that code cannot
// do: which number means what, and what the person wants.

import { choice, noul, score } from '@typesafe-ai/sdk';
import { GENRES, PROVIDERS, PROVIDER_KEYS, ERAS, REGIONS, REGION_KEYS } from './catalog.js';
import { VIBES } from './vibes.js';

const ASK = 'A person is looking for a film to watch. Their request is in `query`.';

// Jev can select only a number that the query contains, thus it cannot invent
// a year or a rating. Find too many here: code decides what to do with them.
export function findNumbers(query) {
  return [...new Set(query.match(/\d+(?:\.\d+)?/g) ?? [])].slice(0, 8);
}

function numberOptions(numbers, role) {
  const opts = { none: `The request does not name ${role}.` };
  for (const n of numbers) opts[n] = `The number ${n}, as it appears in the request.`;
  return opts;
}

const RUNTIME_LEVELS = [
  'They want something short. Ninety minutes or less. They said so, or they have little time.',
  'They lean short, but they did not insist on it.',
  'Length does not come into the request at all.',
  'They lean long. They want something with room to breathe.',
  'They want a long film. An epic, a three hour sit. They said so, or they have a whole evening.',
];

const FAME_LEVELS = [
  'They want the famous films. The ones everybody has seen.',
  'They lean well known, but they did not insist on it.',
  'Fame does not come into the request at all.',
  'They lean obscure. They want something off the beaten track.',
  'They want a deep cut. Something they have never heard of. A hidden gem.',
];

export function buildQuestions({ numbers = [], people = [] } = {}) {
  const q = {};

  // One Noul for each genre, because more than one can apply.
  for (const g of GENRES) {
    q[`g:${g}`] = noul(`${ASK} Are they asking for a ${g} film?`, {
      true: `The request names ${g}, or describes something that is characteristically ${g}.`,
      false: `The request does not point at ${g} films.`,
    });
  }

  // One Noul for each service, for the same reason.
  for (const k of PROVIDER_KEYS) {
    q[`s:${k}`] = noul(
      `${ASK} Do they want the results limited to films they can stream on ${PROVIDERS[k].label}?`,
      {
        true: `The request names ${PROVIDERS[k].label}, or names the service it belongs to.`,
        false: `The request does not name ${PROVIDERS[k].label}.`,
      },
    );
  }

  q.era = choice(
    `${ASK} Which period of film making are they asking for?`,
    Object.fromEntries(Object.entries(ERAS).map(([k, e]) => [
      k,
      k === 'any'
        ? 'The request does not point at any period.'
        : `${e.label}. The request names this period, by decade, by year, or by describing it.`,
    ])),
  );

  // Speculative. Code asks the operator questions for any set of numbers, but
  // reads an operator only when a number comes back.
  if (numbers.length) {
    q.yearNumber = choice(
      `${ASK} Which of the numbers in \`numbers\` is a release year that they named?`,
      numberOptions(numbers, 'a release year'),
    );
    q.yearOp = choice(
      `${ASK} Assume they named a release year. How does that year bound the search?`,
      {
        after: 'Films released in that year or later. "after 2000", "since 2010", "2000 onwards".',
        before: 'Films released in that year or earlier. "before 1990", "up to 1999".',
        exactly: 'Films released in that year alone. "made in 1994".',
      },
    );
    q.ratingNumber = choice(
      `${ASK} Which of the numbers in \`numbers\` is an IMDb rating out of ten that they named?`,
      numberOptions(numbers, 'an IMDb rating'),
    );
    q.ratingOp = choice(
      `${ASK} Assume they named an IMDb rating. How does that rating bound the search?`,
      {
        atLeast: 'The rating is a floor. They want films at or above it. ">8", "at least 7", "rated over 8".',
        atMost: 'The rating is a ceiling. They want films at or below it. "under 4", "the worst films".',
      },
    );
  }

  // Code searched the catalogue for each name that the sentence can point at,
  // including bare surnames. Jev only selects the correct one, thus it cannot
  // name a person that the catalogue does not hold.
  if (people.length) {
    const who = { none: 'The request does not name a real person at all.' };
    for (const p of people) {
      const jobs = [
        p.dir.length ? `directed ${p.dir.length}` : null,
        p.act.length ? `acted in ${p.act.length}` : null,
      ].filter(Boolean).join(' and ');
      who[p.key] = `${p.name}, who ${jobs} of the films in this catalogue.`;
    }
    q.person = choice(
      `${ASK} Which of these people are they asking about? `
      + 'Judge it from the whole sentence: a surname on its own can belong to several '
      + 'of them, and the rest of the request usually says which.',
      who,
    );
    q.personRole = choice(
      `${ASK} Assume they named a person who both directs and acts. Which do they mean?`,
      {
        directed: 'Films this person directed. "a film by", "directed by", "the new Nolan".',
        acted: 'Films this person appears in. "starring", "with", "a Russell Crowe film".',
        either: 'Either would satisfy them. They named the person, not the job.',
      },
    );
  }

  q.region = choice(
    `${ASK} Where should the film come from?`,
    Object.fromEntries(REGION_KEYS.map((k) => [k, REGIONS[k].says])),
  );

  q.subtitled = noul(`${ASK} Are they asking for cinema that is not in the English language?`, {
    true: 'The request asks for foreign language film, world cinema, subtitles, or names a '
      + 'country or language whose films are not in English.',
    false: 'The request says nothing about language, or asks for English language film.',
  });

  q.acclaim = noul(
    `${ASK} Are they asking for films that are held to be very good, without naming a rating?`,
    {
      true: 'The request asks for the best, the greatest, masterpieces, or highly rated films.',
      false: 'The request says nothing about quality, or names a rating number instead.',
    },
  );

  q.family = noul(`${ASK} Do they need a film that is safe to watch with young children?`, {
    true: 'The request names children, or a family audience, or asks for something suitable for kids.',
    false: 'The request does not mention children, or asks for something adult.',
  });

  q.runtime = score(`${ASK} How long a film do they want?`, RUNTIME_LEVELS);
  q.fame = score(`${ASK} How well known a film do they want?`, FAME_LEVELS);

  q.sort = choice(`${ASK} Of the films that fit, which should come first?`, {
    best: 'The highest rated. This is the sensible default when they gave no order.',
    popular: 'The most widely seen and talked about.',
    newest: 'The most recent. They asked for new or latest films.',
    oldest: 'The earliest. They asked for the originals or the first of something.',
  });

  // The thirteen axes, on the same scale used for each film at build time.
  // `v:` is the position they want. `w:` is whether they mentioned the axis. A
  // Score alone cannot show the difference between "they want a calm film" and
  // "they did not mention tension".
  for (const v of VIBES) {
    q[`v:${v.key}`] = score(
      `${ASK} Suppose they do care about ${v.label}. Which of these describes the film `
      + 'they are after? Judge the film they want, not the words they used.',
      v.levels,
    );
    q[`w:${v.key}`] = noul(
      `${ASK} Does the request say anything about ${v.label}?`,
      {
        true: `The request speaks to ${v.label}, either outright or through a mood, an `
          + 'occasion, a company, or a film it wants to be like.',
        false: `Nothing in the request bears on ${v.label}. Any answer about it would be a guess.`,
      },
    );
  }

  return q;
}
