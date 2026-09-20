// Shared vocabulary. The build script, the Jev questions and the browser read
// this file, thus a genre name stays the same in all three.

export const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
  'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery',
  'Romance', 'Science Fiction', 'Thriller', 'War', 'Western',
];

// Short keys keep the dataset small. The browser expands them.
export const GENRE_KEY = Object.fromEntries(GENRES.map((g, i) => [g, i]));

// Australian subscription services. `match` tests the TMDB provider name,
// which has variants such as "Netflix basic with Ads".
export const PROVIDERS = {
  netflix: { label: 'Netflix', match: /^netflix/i },
  prime: { label: 'Prime Video', match: /^amazon prime video/i },
  disney: { label: 'Disney+', match: /^disney plus/i },
  max: { label: 'Max', match: /^(hbo )?max\b/i },
  stan: { label: 'Stan', match: /^stan\b/i },
  binge: { label: 'BINGE', match: /^binge/i },
  apple: { label: 'Apple TV+', match: /^apple tv\+?$|^apple tv plus/i },
  paramount: { label: 'Paramount+', match: /^paramount plus/i },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS);

// Eras carry their own year bounds, so the model never does arithmetic.
export const ERAS = {
  any: { label: 'Any era', from: null, to: null },
  classic: { label: 'Before 1960', from: null, to: 1959 },
  '1960s': { label: 'The 1960s', from: 1960, to: 1969 },
  '1970s': { label: 'The 1970s', from: 1970, to: 1979 },
  '1980s': { label: 'The 1980s', from: 1980, to: 1989 },
  '1990s': { label: 'The 1990s', from: 1990, to: 1999 },
  '2000s': { label: 'The 2000s', from: 2000, to: 2009 },
  '2010s': { label: 'The 2010s', from: 2010, to: 2019 },
  '2020s': { label: 'The 2020s', from: 2020, to: null },
};

// Where a film comes from. Buckets, not single countries, thus code reads the
// distribution as it reads eras. "Scandinavian" need not select one country.
export const REGIONS = {
  anywhere: { label: 'Anywhere', says: 'The request does not say where the film should come from.', c: [] },
  australia: { label: 'Australia and New Zealand', says: 'Australian or New Zealand cinema.', c: ['AU', 'NZ'] },
  britain: { label: 'Britain and Ireland', says: 'British or Irish cinema.', c: ['GB', 'IE', 'MT', 'XI'] },
  america: { label: 'The United States and Canada', says: 'American or Canadian cinema, including Hollywood.', c: ['US', 'CA'] },
  france: { label: 'France and Belgium', says: 'French language cinema.', c: ['FR', 'BE', 'LU', 'MC'] },
  italy: { label: 'Italy', says: 'Italian cinema.', c: ['IT'] },
  iberia: { label: 'Spain, Portugal and Latin America', says: 'Spanish or Portuguese language cinema, from Europe or Latin America.', c: ['ES', 'PT', 'MX', 'AR', 'BR', 'CL', 'CO', 'PE', 'UY', 'CU', 'VE', 'BO', 'EC', 'PY', 'CR', 'GT', 'DO', 'PR', 'PA', 'HN', 'NI', 'SV'] },
  germanic: { label: 'Germany, Austria and the Netherlands', says: 'German or Dutch language cinema.', c: ['DE', 'AT', 'CH', 'NL', 'DD', 'XG'] },
  nordic: { label: 'Scandinavia and the Nordics', says: 'Swedish, Danish, Norwegian, Finnish or Icelandic cinema.', c: ['SE', 'DK', 'NO', 'FI', 'IS', 'FO', 'GL'] },
  eastern: { label: 'Eastern Europe, Greece and Russia', says: 'Polish, Czech, Hungarian, Romanian, Greek, Russian, Ukrainian or Balkan cinema.', c: ['PL', 'CZ', 'SK', 'HU', 'RO', 'RU', 'UA', 'RS', 'HR', 'BG', 'GE', 'EE', 'LT', 'LV', 'GR', 'CY', 'SI', 'BA', 'MK', 'ME', 'AL', 'BY', 'MD', 'AM', 'AZ', 'KZ', 'UZ', 'KG', 'TJ', 'SU', 'CS', 'XC', 'YU', 'XK'] },
  japan: { label: 'Japan', says: 'Japanese cinema, including anime.', c: ['JP'] },
  korea: { label: 'Korea', says: 'South Korean cinema.', c: ['KR'] },
  china: { label: 'China, Hong Kong and Taiwan', says: 'Chinese language cinema, including Hong Kong action and Taiwanese film.', c: ['CN', 'HK', 'TW'] },
  india: { label: 'India and South Asia', says: 'Indian cinema, including Bollywood and regional film, and its neighbours.', c: ['IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'AF'] },
  seasia: { label: 'South East Asia', says: 'Thai, Vietnamese, Indonesian, Filipino, Malaysian or Cambodian cinema.', c: ['TH', 'VN', 'ID', 'PH', 'MY', 'SG', 'KH', 'LA', 'MM', 'MN', 'BN'] },
  mideast: { label: 'The Middle East and North Africa', says: 'Iranian, Turkish, Israeli, Lebanese or Egyptian cinema.', c: ['IR', 'TR', 'IL', 'LB', 'EG', 'SA', 'AE', 'PS', 'MA', 'DZ', 'TN', 'JO', 'IQ', 'SY', 'YE', 'KW', 'QA', 'BH', 'OM', 'LY', 'SD'] },
  africa: { label: 'Sub-Saharan Africa', says: 'African cinema south of the Sahara.', c: ['ZA', 'NG', 'SN', 'KE', 'BF', 'ML', 'GH', 'ET', 'TZ', 'CM', 'UG', 'RW', 'ZW', 'MZ', 'AO', 'CI', 'GN', 'BJ', 'TG', 'NE', 'TD', 'CG', 'CD', 'MG', 'MU', 'BW', 'NA', 'ZM', 'MW', 'SS', 'ER', 'SO'] },
};

export const REGION_KEYS = Object.keys(REGIONS);

// The countries that the build searches, and how deep it goes.
//
// Each bucket above stays available as a query option. Thus you can still find
// a famous Chinese or Brazilian film by region if it arrives through a global
// pass. This list decides only where the build spends its effort. Add a country
// here and the next build includes it.
//
// Depth is pages of twenty, ordered by vote count. Thus US: 45 means the nine
// hundred most watched American films. Increase a number to go deeper into that
// country. The build reports how many films cleared the quality floor.
export const SOURCE_COUNTRIES = {
  US: 45, CA: 10,
  GB: 30, IE: 10, AU: 30, NZ: 14,
  JP: 24, KR: 24,
  FR: 18, IT: 12, ES: 12, DE: 12,
  SE: 8, DK: 8, NO: 5,
};

// Languages that get their own pass. The other passes cover English. A language
// with no source country above does not justify the pages.
export const SOURCE_LANGUAGES = ['ja', 'ko', 'fr', 'it', 'es', 'de', 'sv', 'da', 'nl', 'no'];

// Each country in a named region, for the build step.
export const REGION_COUNTRIES = [...new Set(Object.values(REGIONS).flatMap((r) => r.c))];

// Country code -> region key. An unlisted code falls back to `anywhere`.
export const REGION_OF = Object.fromEntries(
  Object.entries(REGIONS).flatMap(([key, r]) => r.c.map((code) => [code, key])),
);

export function POSTER(path, size) {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
