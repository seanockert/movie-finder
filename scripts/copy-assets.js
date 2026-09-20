// Two files that the browser needs, which are not in public/. The dev server
// aliases them in memory. Static assets must be real files, thus the build
// copies them first. Git ignores both copies.
import { copyFile } from 'node:fs/promises';

const COPY = [
  ['../lib/catalog.js', '../public/catalog.js'],
  ['../node_modules/matter-js/build/matter.min.js', '../public/matter.js'],
];

await Promise.all(COPY.map(([from, to]) => copyFile(
  new URL(from, import.meta.url),
  new URL(to, import.meta.url),
)));

console.log(`Copied ${COPY.length} files into public/`);
