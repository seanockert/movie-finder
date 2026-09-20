// Thirteen axes for a film.
//
// The levels are written once and used in both directions. At build time Jev
// puts each film on them. At query time it puts the request on the same levels.
// The scale is the same text, thus the distance between the two has a meaning.
// Code does the arithmetic.

export const VIBES = [
  {
    key: 'comfort',
    label: 'comfort',
    ask: 'How comforting is this film to sit through?',
    levels: [
      'Harrowing. It leaves you shaken and you need a moment afterwards.',
      'Heavy going. Not something you put on to relax.',
      'Neither soothing nor punishing.',
      'Easy company. Warm, low stress, nothing to brace for.',
      'A blanket. Pure comfort viewing you could happily fall asleep to.',
    ],
  },
  {
    key: 'tension',
    label: 'tension',
    ask: 'How much tension does this film hold?',
    levels: [
      'Completely calm. Nothing is ever really at stake.',
      'Mild. The odd moment of worry, quickly resolved.',
      'Real stakes, but it lets you breathe between them.',
      'Tense for long stretches. You watch it leaning forward.',
      'Nerve shredding from beginning to end.',
    ],
  },
  {
    key: 'humour',
    label: 'humour',
    ask: 'How funny is this film?',
    levels: [
      'No jokes at all. Laughing would feel wrong.',
      'Occasional dry wit, but nobody would call it a comedy.',
      'Often amusing. Humour runs through it without being the point.',
      'Genuinely funny. Laughs are a main reason to watch.',
      'Relentlessly funny. It exists to make you laugh.',
    ],
  },
  {
    key: 'heart',
    label: 'emotional weight',
    ask: 'How emotionally moving is this film?',
    levels: [
      'Cold on purpose. It keeps you at arm’s length.',
      'Some feeling, but it is not what the film is for.',
      'Moving in places.',
      'Deeply affecting. Most people feel it in their chest.',
      'Devastating. It is built to make you cry.',
    ],
  },
  {
    key: 'spectacle',
    label: 'scale',
    ask: 'How big does this film look and sound?',
    levels: [
      'Tiny. A few rooms and a few faces.',
      'Modest. Ordinary places at ordinary scale.',
      'Some scale, used sparingly.',
      'Big. Made to be seen on a large screen.',
      'Enormous. Spectacle is the reason it exists.',
    ],
  },
  {
    key: 'brains',
    label: 'how much work it is',
    ask: 'How much concentration does this film need?',
    levels: [
      'Effortless. You could look at your phone and keep up.',
      'Straightforward. Everything is explained as it happens.',
      'Asks for a little attention.',
      'Demanding. It rewards concentration and may want a second watch.',
      'A puzzle. People still argue about what actually happened.',
    ],
  },
  {
    key: 'strange',
    label: 'strangeness',
    ask: 'How strange is this film?',
    levels: [
      'Entirely conventional. It goes exactly where you expect.',
      'Familiar shape with one or two surprises.',
      'Has a voice of its own but stays easy to read.',
      'Odd. Dream logic, an unusual tone, or an unusual form.',
      'Genuinely surreal. It abandons ordinary reality.',
    ],
  },
  {
    key: 'romance',
    label: 'romance',
    ask: 'How central is love to this film?',
    levels: [
      'No romance at all.',
      'A romance exists somewhere at the edges.',
      'A romantic thread runs alongside the main story.',
      'Love is one of the two things the film is about.',
      'It is a love story. Everything else is in service of it.',
    ],
  },
  {
    key: 'pace',
    label: 'pace',
    ask: 'How fast does this film move?',
    levels: [
      'Very slow. Long takes, little plot, room to think.',
      'Unhurried. It takes its time getting anywhere.',
      'Steady.',
      'Brisk. It keeps pushing forward.',
      'Relentless. It never stops for breath.',
    ],
  },
  {
    key: 'grit',
    label: 'harshness',
    ask: 'How harsh is the content of this film?',
    levels: [
      'Gentle throughout. Nothing in it would upset anyone.',
      'Mild. The odd hard moment.',
      'Some real violence, language or adult content.',
      'Harsh. Cruelty, violence or despair are front and centre.',
      'Brutal. Hard to watch, and meant to be.',
    ],
  },
  {
    key: 'wonder',
    label: 'wonder',
    ask: 'How much awe or magic is in this film?',
    levels: [
      'Wholly grounded. The world works exactly as ours does.',
      'Realistic, with a touch of the extraordinary.',
      'Heightened reality.',
      'Full of wonder. Magic, the far future, or the impossible.',
      'Pure awe. It exists to show you something you could never see.',
    ],
  },
  {
    key: 'beauty',
    label: 'how beautiful it is to look at',
    ask: 'How beautiful is this film to look at?',
    levels: [
      'Plain. Nobody made a decision about how it looks.',
      'Competent. It looks fine and you never think about it.',
      'Handsome. Real care has gone into the images.',
      'Beautiful. People remember how it looked.',
      'Ravishing. You could watch it with the sound off.',
    ],
  },
  {
    key: 'crowd',
    label: 'watching alone or with people',
    ask: 'Who is this film best watched with?',
    levels: [
      'Alone. It needs quiet and undivided attention.',
      'Alone, or with one other person.',
      'Works either way.',
      'Better with company. Half the fun is reacting together.',
      'A party film. The crowd is most of the experience.',
    ],
  },
];

export const VIBE_KEYS = VIBES.map((v) => v.key);
const LEVELS = 4;   // scores run 0..4

// Stored as integers 0..40, to keep the vectors small on disk.
export const packVibes = (scores) => VIBE_KEYS.map((k) => Math.round(scores[k] * 10));
export const unpackVibes = (packed) => packed.map((n) => n / 10);

// How near a film is to the request, on the axes that the request mentions.
// Code owns the weights and the curve. The model gives only the positions.
export function vibeMatch(vector, want) {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < VIBES.length; i++) {
    const w = want.weights[i];
    if (w < want.floor) continue;
    total += w * (1 - Math.abs(vector[i] - want.targets[i]) / LEVELS);
    weight += w;
  }
  return weight ? total / weight : null;   // null = the request said nothing
}
