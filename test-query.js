// Check the model from the terminal.
//
//   npm run test-query
//   npm run test-query "90s action on netflix" "a rainy sunday afternoon"

import { recommend } from './lib/recommend.js';

const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : [
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

const pad = (s, n) => String(s).padEnd(n);

for (const query of QUERIES) {
  const t = Date.now();
  const r = await recommend(query);
  const c = r.cost;
  const usd = c.stage1.costUsd + (c.stage2?.costUsd ?? 0);

  console.log(`\n── ${query}`);
  console.log(`   filters: ${r.plan.join(' | ') || 'none'}`);
  if (r.relaxed.length) console.log(`   relaxed: ${r.relaxed.join(', ')}`);
  console.log(`   ${r.counts.kept} kept of ${r.counts.catalog}, ${r.counts.shortlist} ranked`);
  for (const m of r.picks) {
    console.log(`   ${pad(`${(m.match * 100).toFixed(0)}%`, 5)} ${pad(m.title, 38)} ${m.year}  `
      + `${m.rating.toFixed(1)}  ${m.services.map((s) => s.label).join(', ') || '—'}`);
  }
  console.log(`   ${c.stage1.questions}+${c.stage2?.questions ?? 0}q  ${Date.now() - t}ms  $${usd.toFixed(6)}`);
}
