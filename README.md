# Movie Finder

Type what you feel like watching. A pile of posters sits at the bottom of the
screen. The films that match move up under the input.

Two [Jev](https://docs.typesafe.ai) requests answer each query. Code does the
filtering between them.

```sh
npm install
cp .env.example .env      # add TYPESAFE_API_KEY and TMDB_API_KEY
npm run build-data        # once, about 20 minutes
npm run dev               # http://127.0.0.1:5174
```

**Do a smoke test first.** `CORPUS=60 npm run build-data` runs the full pipeline
in about a minute for much less than a cent. It prints a field coverage report.
If TMDB changes a response shape, keywords or certificates drop to near zero.
You see this before you start the full run.

Use `CORPUS=1500` for a quicker real run. The default is 9,000.

The TMDB and IMDb half of the build costs the same at any `CORPUS`, because the
build fetches every candidate before the cut. Only the vibe pass scales, at
about 25 films a second and $0.057 for each thousand films. A larger corpus is
therefore cheap.

The vibe cache has a version number. If the evidence that Jev sees changes, the
version moves and the next build scores all films again. This prevents a mix of
two kinds of vector.

The vibe pass writes each vector to `data/vibes.json` immediately. A second run
at a larger size pays only for the new films, and an interrupted build starts
again where it stopped.

## How a query is answered

```
  build once   ~9000 films x 13 Score questions  ->  one vector per film
                                                     (cached; never rerun)

"something slow and beautiful where nothing much happens"
        |
        |  stage 1   one request, 60 to 66 questions
        v
   genres: none | era: any | region: anywhere
   pace 0.4/4 (weight 0.91) | spectacle 1.1/4 (0.62) | tension 0.6/4 (0.78)
        |
        |  code      filters, then a mood match over every film that passed
        v            no network call; Jev made these judgments at build time
        |
        |  stage 2   one request, 30 graded Scores
        v
   Paterson 0.91 | Certified Copy 0.88 | Columbus 0.84
```

### Build time: each film gets a position on thirteen axes

This step makes the rest cheap. Each film goes to Jev once, with thirteen
**Score** questions in one request: comfort, tension, humour, emotional weight,
scale, how much work it is, strangeness, romance, pace, harshness, wonder,
beauty, and whether it is better alone or with a crowd. Each axis has five
levels, written once in `lib/vibes.js`.

One request for each film, at about 25 films a second. Each film comes back
with thirteen numbers.

Jev sees the title, year, genres, runtime, rating, director, top billed cast,
TMDB keywords, certificate, tagline and synopsis. It sees no reviews and no
script. The judgment must come from that data.

### Stage one: the sentence becomes typed filters

| Question | Type | Reads as |
| --- | --- | --- |
| `g:<genre>` × 18 | Noul | One for each genre, because more than one can apply. "funny sci-fi" gives two |
| `s:<service>` × 8 | Noul | One for each AU service. Netflix, Stan, BINGE, Disney+, Max, Prime, Apple TV+, Paramount+ |
| `era` | Choice, 9 | Decade buckets, each with its own year bounds. Code reads the **full spread**, so "the late 90s or early 2000s" makes the window wider |
| `yearNumber` `ratingNumber` | Choice | **Which number is which.** See below |
| `yearOp` `ratingOp` | Choice | after / before / exactly, and atLeast / atMost |
| `runtime` `fame` | Score, 5 | "something short", "a hidden gem nobody has seen" |
| `acclaim` `family` | Noul | "the greatest", "safe for my six year old" |
| `sort` | Choice, 4 | best / popular / newest / oldest |
| `person` | Choice | **Which person the sentence means.** Code searches the catalogue first; see below |
| `personRole` | Choice | Directed by them, appearing in them, or either |
| `region` | Choice, 17 | Where the film comes from, in buckets. Code reads the spread, so "Scandinavian" does not have to select one country |
| `subtitled` | Noul | "world cinema", "with subtitles", "not in English" |
| `v:<axis>` × 13 | Score | Where on each axis the wanted film sits, **on the same five levels used for each film at build time** |
| `w:<axis>` × 13 | Noul | Does the request say anything about this axis? |

**Names work in the same way as numbers.** The catalogue holds each director
and the top six billed cast for each film, indexed by full name and by surname.
Code scans the sentence for each name that can match, including bare surnames.
Code finds too many on purpose. Jev then selects the correct one. `none` is
always available, so Jev cannot name a person that the catalogue does not hold.

`"cameron"` gives James Cameron, Cameron Crowe and Cameron Diaz. The remainder
of the sentence decides. If a person only directed, or only acted, the
catalogue answers `personRole` and code discards the answer from Jev.

A named person is the only filter that code **never relaxes**. If you ask for
Russell Crowe and there are three films, three is the correct answer.

The `v:`/`w:` pair is the important one. A Score alone cannot show the
difference between *"they want a calm film"* and *"they did not mention
tension"*. Both results are near the middle of the scale. The Noul gives
presence, the Score gives position, and code uses the Noul as the weight. An
axis that nobody mentions gets a weight near zero and leaves the match.

Code puts the request on **the same five levels** as each film in the
catalogue. Thus the distance between the two is arithmetic. The mood search
runs over all the films, in code, in less than a millisecond. It makes no call
at request time. The weights, the curve, and the effect of mood on the sort
order are all in `lib/filter.js`. You can change them without a new build.

**Which number is which** is the clearest task that Jev does here. A regex finds
each number in the sentence. Jev selects only from the numbers that are
already there, thus it cannot invent one. Code then checks the range of the
selection: a year cannot be `8` and a rating cannot be `2000`. An error of this
type cannot reach the filter.

Code asks the year and rating operator questions even if it finds no number.
The questions are speculative: code reads an operator only when a number comes
back. This is one request in each case.

### Stage two: one graded score for each film

The vibe match does the wide search. Stage two is therefore an accurate pass
over thirty candidates.

The shortlist goes into the state. Each film gets one **Score** over five
levels, from *wrong film* to *exactly this*. That is thirty judgments in one
request, over shared state. Jev thus grades the films against each other and
against the same words.

A Noul is the incorrect primitive here. Each candidate passed the hard filters
already. Thus "is this a good answer, yes or no?" gives a narrow band near zero
and cannot separate thirty films that fit almost equally well. Five levels
separate them. The question also says at the start that genre, year, rating and
service are already correct. Jev thus uses its judgment on what remains.

The ranking and the cut-off both use **P(strong or better)**: the probability
mass on the top two levels. Below `PICK_MIN` (0.45) the UI does not show a
film, and the row can stay empty. Code adds no films to fill it.

Filters cannot do this. "Something to watch when I'm sad" names no genre, no
year and no service.

## What code owns, not the model

- **Each threshold.** Genre at 0.55, service at 0.6. A Score must sit 0.7 from
  the centre to count. All are in `lib/filter.js`. Change one and no request
  runs again.
- **Each range check.** Years, ratings, runtimes.
- **Keyword search.** "heist", "christmas", "time travel" and "zombie" match
  TMDB keywords in code. There is no Jev question, because the film already has
  the tag.
- **Series caps.** Two films for each series in the shortlist. Six Marvel films
  is a worse answer than four good ones.
- **Age ratings.** A real certificate decides the kid-safe filter. Code folds
  the certificate to one tier, thus no later step must know that AU says MA15+
  and the US says R. The genre heuristic is only a fallback for unrated films.
- **When to ignore an answer.** Code discards a number selection below 35%
  confidence. If `sort` is unsure, code uses best-rated.
- **The relaxation ladder.** If a query is too narrow to match anything, code
  drops the softest filter and tries again, then drops the next. The UI says
  which filters went. The order is: fame, runtime, implied acclaim, family,
  genre (all, then any), era, year, stated rating, language, region, service. A
  named service is the last to go.
- **The catalogue.** Jev never sees the full corpus, only the thirty films that
  passed. It cannot name a film that code did not give it.
- **The mood arithmetic.** Jev gives the positions on the axes. Code does the
  weighting, the combination, and the balance against the sort order. A change
  of weight is thus free.

Code does one thing **deliberately not**: it keeps the vibe vector out of the
stage two state. The vector came from Jev. To give a model its own earlier
answer as evidence makes a guess look like a fact.

## The data

The build writes `data/movies.json` once. At request time nothing leaves the
machine except the two Jev calls.

**Where the films come from.** `SOURCE_COUNTRIES` in `lib/catalog.js` lists the
countries that the build searches, with a depth in pages of twenty. Thus
`US: 45` means the nine hundred most watched American films. The list holds the
US and Canada, Britain and Ireland, Australia and New Zealand, Japan, Korea,
France, Italy, Spain, Germany and the Nordics. Films from other countries can
still reach the corpus through the global and decade passes, but only if they
are popular enough. Add a country to that object and the next build includes it.

All seventeen region buckets stay available as query options. Thus you can
still find a famous Chinese or Brazilian film by region if it arrives through a
global pass.

- **TMDB** — posters, genres, runtime, overview, origin country, original
  language, director, top billed cast, keywords, age certificate, series and AU
  streaming providers. This needs a free key. Credits, keywords and certificates
  come with the detail call, thus they cost no extra request.
- **IMDb** — the official rating, from `datasets.imdbws.com`. This needs no key
  and updates daily. The two sources join on the IMDb id that TMDB holds.

The corpus holds about 9,000 films. The pile shows 96 of them (`PILE`, in
`lib/api.js`). You can change this without a new build.

The pile follows the window. If you drag the edge, code scales the poster
positions to the new width and wakes each body. A wider window thus spreads the
heap, and a narrower window packs it together.

A pick always comes **out of the heap**. If the film is not in the pile, the
pile changes a poster near its surface a moment before the pull. Thus no poster
arrives from off screen. The poster gets an upward impulse and the physics
continues for 310 ms, so the heap falls into the gap. CSS then takes over and
moves the poster to the row below the input.

## Files

```
lib/catalog.js      genres, AU services, era bounds, region buckets
lib/vibes.js        the thirteen axes and the match, used at build and query time
lib/people.js       the name index, the finder, and who did which job
lib/certificates.js age ratings from a dozen countries, folded to one tier
lib/questions.js    stage one. The questions and the number finder
lib/filter.js       the plan, the thresholds, the relaxation ladder
lib/recommend.js    both stages and the cost
lib/api.js          what the two servers send and log
scripts/build-data.js   TMDB + IMDb -> data/movies.json
public/pile.js      Matter.js drives the posters, CSS takes over when picked
public/main.js      typing placeholder, debounce, the pick sequence, the panel
test-filters.js     offline checks for the thresholds and the ladder
server.js           the Node dev server
src/worker.js       the same two endpoints, for Cloudflare Workers
scripts/copy-assets.js  puts catalog.js and matter.js into public/
```

## Deploy

This runs on Cloudflare Workers. The Worker holds the catalogue in its bundle
and parses it once for each isolate at start up. A live query thus costs only
the two Jev calls.

```sh
npx wrangler secret put TYPESAFE_API_KEY   # once for each Worker
npm run deploy                             # https://movie-finder.seanockert.workers.dev
npm run tail                               # live logs
```

`npm run dev-worker` runs the Worker locally on workerd in place of Node. It
reads the key from `.dev.vars`. Copy the `TYPESAFE_API_KEY` line of `.env` into
that file first.

**Watch the bundle size.** A 9,000 film corpus is 2,981 KiB gzipped, against a
3 MiB Worker limit on the free plan. A larger `CORPUS` goes above the limit. The
paid plan permits 10 MiB.

The dev server aliases `lib/catalog.js` and `matter-js` in memory. Static assets
must be real files, thus `npm run copy-assets` writes both into `public/`.
`predeploy` runs it for you. Git ignores both copies.

## Check the model

```sh
npm run test-query
npm run test-query "90s action on netflix" "a rainy sunday afternoon"
```

This prints the filters, the relaxed filters, the picks with their
probabilities, and the cost.

## Check the logic

```sh
npm run test-filters
```

This runs the plan, the range checks and the relaxation ladder against a
synthetic catalogue. It needs no key, no network and no `data/movies.json`.

## Notes

- The keys stay on the server. The browser calls only `/api/pile` and
  `/api/recommend`.
- The model is pinned to `jev-1.13.0`. An alias can change answers without
  warning.
- Typing is debounced one second. Enter skips the wait. A new request aborts the
  request that is in flight.
- The app never sends a sentence that is already on screen. It caches the last
  fifty answers in the tab, thus an example query costs nothing a second time.
  Cache hits appear in the console.
- The counts, the times and the cost go to the browser console. The page shows
  text only if something fails.
- The placeholder types example queries and stops while the box has text. It
  does not move under `prefers-reduced-motion`.
- Details on hover use CSS anchor positioning, anchored to the poster. Browsers
  without this feature show a fixed offset below the slot.
- Streaming data comes from JustWatch through TMDB. Attribute it to JustWatch if
  this becomes public.
- `query` is user text. A person can type a sentence that argues for its own
  rating.
