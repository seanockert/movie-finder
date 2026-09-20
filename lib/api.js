// The two endpoints, without the transport. server.js uses node http and
// src/worker.js uses fetch, but they send and log the same data.

const PILE = 96;        // posters on screen. The rest of the corpus stays off stage.
const PILE_WIDE = 146;  // a wide screen has floor to spare, so it gets more
const WIDE = 1500;      // px of viewport that counts as wide
const MAX_QUERY = 200;
const MIN_QUERY = 3;

// The posters in the pile. Sent once at load. The client gives its width, thus
// a wide screen gets a deeper heap.
export function pilePayload(catalog, built, viewportWidth) {
  const want = Number.isFinite(viewportWidth) && viewportWidth >= WIDE ? PILE_WIDE : PILE;
  return {
    built,
    total: catalog.length,
    pile: catalog.slice(0, Math.min(want, catalog.length))
      .map((m) => ({ id: m.id, t: m.t, p: m.p })),
  };
}

// Null = the request is too short to answer.
export function cleanQuery(query) {
  const clean = String(query ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
  return clean.length < MIN_QUERY ? null : clean;
}

export function logResult(query, result, ms) {
  const { stage1, stage2 } = result.cost;
  console.log(
    `"${query}" -> ${result.picks.length} picks | `
    + `${result.counts.kept} kept, ${result.counts.shortlist} ranked | `
    + `${stage1.questions}+${stage2?.questions ?? 0}q ${ms}ms `
    + `$${(stage1.costUsd + (stage2?.costUsd ?? 0)).toFixed(6)}`
    + (result.relaxed.length ? ` | relaxed: ${result.relaxed.join(', ')}` : ''),
  );
}
