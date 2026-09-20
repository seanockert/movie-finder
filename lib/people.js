// Directors and cast, indexed by name.
//
// Code holds the index and finds each possible name in the sentence. It finds
// too many on purpose. Jev then selects the candidate that the request means,
// thus Jev cannot invent a name. This is the pre-parsed value extraction
// pattern, with the catalogue as the source.

const MAX_SPAN = 4;        // "jean pierre jeunet" is three, permit one more
const MIN_SURNAME = 4;
const MAX_CANDIDATES = 12;

// Words that are also surnames. A match on these alone is almost always wrong.
const NOT_A_NAME = new Set(('a about after all also an and any are as at back bad be best big '
  + 'black blue but by can cold come dark day dead deep does down early end even every fast '
  + 'film films first for free from front funny get give go god good great green half hard '
  + 'has have her here high him his hot how i im in into is it its just keep kind king last '
  + 'late less life light like little long look love made make man me men mind more most much '
  + 'my need new night no not now of off old on one only or other out over people place play '
  + 'post real right same see set she short show side slow small so some something still stone '
  + 'story strange sweet take tale that the their them then there these they thing this those '
  + 'three time to top true two under up very want was watch water way we well what when where '
  + 'which white who why wild will wise with wood world would year young your').split(' '));

export const normalise = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// name -> { name, dir: [movieId], act: [movieId] }
export function buildPeopleIndex(catalog) {
  const byName = new Map();
  const bySurname = new Map();

  const touch = (raw) => {
    const key = normalise(raw);
    if (!key) return null;
    let entry = byName.get(key);
    if (!entry) {
      entry = { key, name: raw, dir: [], act: [] };
      byName.set(key, entry);

      const surname = key.split(' ').at(-1);
      if (surname.length >= MIN_SURNAME && !NOT_A_NAME.has(surname)) {
        if (!bySurname.has(surname)) bySurname.set(surname, []);
        bySurname.get(surname).push(entry);
      }
    }
    return entry;
  };

  for (const m of catalog) {
    for (const raw of m.d ?? []) touch(raw)?.dir.push(m.id);
    for (const raw of m.ca ?? []) touch(raw)?.act.push(m.id);
  }
  return { byName, bySurname };
}

const credits = (p) => p.dir.length + p.act.length;

// Each name that the sentence can point at. Too many is safe: Jev selects one,
// and "none" is always in the list.
export function findPeople(index, query) {
  const words = normalise(query).split(' ').filter(Boolean);
  const found = new Map();

  const offer = (entry, exact) => {
    const seen = found.get(entry.key);
    if (!seen || (exact && !seen.exact)) found.set(entry.key, { entry, exact });
  };

  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(MAX_SPAN, words.length - i); n >= 1; n--) {
      const span = words.slice(i, i + n).join(' ');
      const hit = index.byName.get(span);
      if (hit) offer(hit, true);
      // A bare surname is ambiguous on purpose. "cameron" gives James Cameron
      // and Cameron Diaz. The remainder of the sentence decides.
      if (n === 1 && !hit) {
        for (const p of index.bySurname.get(span) ?? []) offer(p, false);
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => (b.exact - a.exact) || (credits(b.entry) - credits(a.entry)))
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.entry);
}

// What the person did in this catalogue. If they did only one of the two jobs,
// code answers the role question and does not use the answer from Jev.
export function roleOf(entry, asked) {
  if (!entry.act.length) return 'directed';
  if (!entry.dir.length) return 'acted';
  return asked;
}

export function filmsOf(entry, role) {
  if (role === 'directed') return new Set(entry.dir);
  if (role === 'acted') return new Set(entry.act);
  return new Set([...entry.dir, ...entry.act]);
}
