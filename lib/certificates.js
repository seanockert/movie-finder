// Age certificates from a dozen countries, folded to one number. Thus no later
// step must know that Australia says MA15+, Germany says 16 and Japan says
// R15+.
//
//   0 everyone   1 young children with a parent   2 older children
//   3 teenagers  4 adults only                    null unrated

// Most systems number their tiers and agree, thus one table covers them.
const TIER = {
  // everyone
  G: 0, U: 0, E: 0, T: 0, L: 0, TP: 0, APTA: 0, AL: 0, ALL: 0, AA: 0,
  BTL: 0, KT: 0, '0': 0,
  // young children with a parent
  PG: 1, UA: 1, '6': 1, '7': 1, '9': 1, '10': 1, '10A': 1, PG12: 1,
  // older children
  M: 2, 'PG-13': 2, '11': 2, '12': 2, '12A': 2, '13': 2, 'M/PG': 2,
  // teenagers
  'MA15+': 3, MA: 3, R: 3, '14': 3, '14A': 3, '15': 3, '15A': 3, '16': 3,
  'R15+': 3, B15: 3, VM14: 3,
  // adults only
  'R18+': 4, 'NC-17': 4, NC17: 4, '17': 4, '18': 4, '18A': 4, '19': 4,
  'X18+': 4, X: 4, VM18: 4, R18: 4,
};

// Letters with opposite meanings in different countries. The A of India is
// adults only. The A of Mexico is everyone. A guess is worse than no answer,
// thus the country decides.
const BY_COUNTRY = {
  IN: { U: 0, UA: 1, 'UA 7+': 1, 'UA 13+': 2, 'UA 16+': 3, A: 4, S: 4 },
  MX: { AA: 0, A: 0, B: 2, B15: 3, C: 4, D: 4 },
  BR: { L: 0, '10': 1, '12': 2, '14': 3, '16': 3, '18': 4 },
  PT: { 'M/3': 0, 'M/6': 1, 'M/12': 2, 'M/14': 3, 'M/16': 3, 'M/18': 4 },
  PH: { G: 0, PG: 1, 'R-13': 2, 'R-16': 3, 'R-18': 4, X: 4 },
};

export function tierOf(raw, country) {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const local = BY_COUNTRY[country];
  if (local) {
    const hit = local[text] ?? local[text.toUpperCase()];
    if (hit !== undefined) return hit;
    // Do not guess an unknown code from a country that has its own table.
    return undefined;
  }
  return TIER[text.toUpperCase()] ?? TIER[text];
}

// Use the systems that we read most accurately first. Then accept any country
// that gives a clear answer. An unrated film stays null, and the genre
// heuristic covers it in a later step.
export function ageTier(results, home = 'AU') {
  if (!results?.length) return null;
  const preferred = [home, 'US', 'GB'];
  const order = [
    ...preferred.map((c) => results.find((r) => r.iso_3166_1 === c)).filter(Boolean),
    ...results.filter((r) => !preferred.includes(r.iso_3166_1)),
  ];
  for (const entry of order) {
    for (const rd of entry.release_dates ?? []) {
      const tier = tierOf(rd.certification, entry.iso_3166_1);
      if (tier !== undefined) return tier;
    }
  }
  return null;
}
