// The poster pile. Matter.js runs the physics with no renderer. Each body
// drives one <div> with absolute position. A poster thus stays sharp, and a CSS
// transition can take control when you pick it.
//
// The bodies stay rigid rectangles. The transform does all the squash, stretch
// and shake, thus the solver does not see it.

const { Engine, Runner, Bodies, Composite, Body, Sleeping, Mouse, MouseConstraint, Events } = window.Matter;

const W = 46;
const H = 69;
const MAX_BODIES = 180;  // minimum. A larger pile increases its own limit.
const DROP_SPAN = 900;   // ms for the full pile to arrive, at any size
const DROP_H = 500;      // px above the screen where the posters start
const DROP_V = 6;        // they enter in motion, not at rest
const CROUCH = 70;       // ms that the poster dips before it moves up
const YANK = 310;        // ms from pick to CSS control, the dip included

// ---- animation values. Change these first. ----
const SQUASH_K = 0.28;      // spring stiffness
const SQUASH_D = 0.78;      // spring damping. A lower value rings for less time.
const SQUASH_MAX = 0.11;    // a hard hit must not make the poster flat
const SQUASH_GAIN = 0.006;  // squash for each unit of impact
const SQUASH_REST = 0.006;  // below this the spring is flat and stops
const SQUASH_GAP = 110;     // ms before the same poster can get a second kick
const IMPACT_MIN = 4.5;     // below this the pile is only settling
const SMEAR_MIN = 13;       // speed at which a poster starts to streak
const SMEAR_GAIN = 0.012;
const SMEAR_MAX = 0.15;
const SMEAR_LERP = 0.18;    // speed at which the streak follows the heading
const SHOVE_R = 88;         // px that the cursor opens the pile
const SHOVE_F = 0.0016;
const WAVE_R = 130;         // px that a hard landing pushes
const WAVE_F = 0.012;
const SHAKE_MAX = 2.4;      // px
const SHAKE_D = 0.82;

export function createPile(root, posterUrl) {
  const engine = Engine.create();
  engine.enableSleeping = true;      // a settled pile costs nothing
  engine.gravity.y = 2.4;            // posters must feel like card, not paper
  engine.positionIterations = 8;     // a heavier stack needs a stronger solve

  Runner.run(Runner.create(), engine);

  let walls = [];
  let size = { w: root.clientWidth, h: root.clientHeight };

  function buildWalls() {
    Composite.remove(engine.world, walls);
    const w = root.clientWidth;
    const h = root.clientHeight;
    const opt = { isStatic: true, restitution: 0.02, friction: 0.9 };
    walls = [
      Bodies.rectangle(w / 2, h + 60, w * 3, 120, opt),   // floor
      Bodies.rectangle(-60, h / 2, 120, h * 4, opt),      // left
      Bodies.rectangle(w + 60, h / 2, 120, h * 4, opt),   // right
    ];
    Composite.add(engine.world, walls);
  }
  buildWalls();

  const mouse = Mouse.create(root);
  const mc = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.3, render: { visible: false } },   // heavy bodies need a firm grip
  });
  Composite.add(engine.world, mc);
  root.removeEventListener('wheel', mouse.mousewheel);   // let the page behave

  const items = new Map();   // movie id -> { el, body | null }
  let maxBodies = MAX_BODIES;

  // ---- squash ----
  // Each poster has a damped spring. A hit kicks it, and the spring rings down.

  const squash = new WeakMap();

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  // A push from below the poster. The pluck has no collision to read, but it
  // must still squash from the bottom edge up.
  function footHit(body) {
    const nx = -Math.sin(body.angle);
    const ny = Math.cos(body.angle);
    return { nx, ny, px: body.position.x + nx * H / 2, py: body.position.y + ny * H / 2 };
  }

  // A poster in a dense heap makes and breaks contacts continuously. Without
  // the gap, each contact kicks the spring again and the pile vibrates.
  //
  // `hit` gives the geometry: nx/ny is the direction of the push, and px/py is
  // where it landed. Both are world values. Code puts them into the frame of
  // the poster, thus the dent stays in position as the poster turns. The newest
  // hit wins.
  function kickSquash(body, amount, hit = null, deliberate = false) {
    if (!body || !body.el) return;                 // walls have no element
    const now = performance.now();
    const sq = squash.get(body) ?? { s: 0, v: 0, t: -Infinity, na: Math.PI / 2, ox: 0, oy: 0 };
    if (!deliberate && now - sq.t < SQUASH_GAP) return;
    sq.t = now;
    sq.v += amount;

    if (hit) {
      const c = Math.cos(-body.angle);
      const n = Math.sin(-body.angle);
      sq.na = Math.atan2(hit.nx * n + hit.ny * c, hit.nx * c - hit.ny * n);
      const dx = hit.px - body.position.x;
      const dy = hit.py - body.position.y;
      sq.ox = clamp(dx * c - dy * n, -W / 2, W / 2);
      sq.oy = clamp(dx * n + dy * c, -H / 2, H / 2);
    }
    squash.set(body, sq);
  }

  // ---- screen shake ----

  let shake = 0;
  let shakePhase = 0;

  function addShake(amount) {
    shake = Math.min(shake + amount, SHAKE_MAX);
  }

  // ---- shockwave ----
  // A poster that returns to the pile pushes the heap away where it lands.

  function shockwave(at) {
    addShake(2.4);
    for (const body of Composite.allBodies(engine.world)) {
      if (!body.el || body.isStatic) continue;
      const dx = body.position.x - at.x;
      const dy = body.position.y - at.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > WAVE_R * WAVE_R || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const falloff = 1 - d / WAVE_R;
      Sleeping.set(body, false);
      Body.applyForce(body, body.position, {
        x: (dx / d) * WAVE_F * falloff * body.mass,
        y: (dy / d) * WAVE_F * falloff * body.mass * 0.6,   // push out more than up
      });
      kickSquash(body, 0.07 * falloff, {
        nx: dx / d, ny: dy / d,             // the blast moves along this line
        px: body.position.x - (dx / d) * W / 2,
        py: body.position.y - (dy / d) * H / 2,   // dent the side that faces the blast
      });
    }
  }

  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) {
      const { bodyA, bodyB, collision } = pair;
      const rvx = bodyB.velocity.x - bodyA.velocity.x;
      const rvy = bodyB.velocity.y - bodyA.velocity.y;
      const impact = Math.abs(rvx * collision.normal.x + rvy * collision.normal.y);
      if (impact < IMPACT_MIN) continue;

      const amount = Math.min(impact * SQUASH_GAIN, SQUASH_MAX);
      const at = collision.supports?.[0] ?? {
        x: (bodyA.position.x + bodyB.position.x) / 2,
        y: (bodyA.position.y + bodyB.position.y) / 2,
      };
      const hit = { nx: collision.normal.x, ny: collision.normal.y, px: at.x, py: at.y };
      kickSquash(bodyA, amount, hit);
      kickSquash(bodyB, amount, hit);
      if (impact > 16) addShake(impact * 0.06);

      const waver = [bodyA, bodyB].find((b) => b.wave);
      if (waver && impact > 4) {
        waver.wave = false;          // one wave for each return, at the first landing
        shockwave(waver.position);
      }
    }
  });

  // ---- cursor parting ----
  // The pile opens around the pointer before you click.

  let hover = false;
  root.addEventListener('pointermove', () => { hover = true; });
  root.addEventListener('pointerleave', () => { hover = false; });

  Events.on(engine, 'beforeUpdate', () => {
    if (!hover || mc.body) return;         // a dragged poster owns the cursor
    const m = mouse.position;
    for (const body of Composite.allBodies(engine.world)) {
      if (!body.el || body.isStatic) continue;
      const dx = body.position.x - m.x;
      const dy = body.position.y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > SHOVE_R * SHOVE_R || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const falloff = (1 - d / SHOVE_R) ** 2;
      Sleeping.set(body, false);
      Body.applyForce(body, body.position, {
        x: (dx / d) * SHOVE_F * falloff * body.mass,
        y: (dy / d) * SHOVE_F * falloff * body.mass,
      });
    }
  });

  // ---- elements ----

  function makeEl(movie) {
    const el = document.createElement('div');
    el.className = 'poster';
    el.style.backgroundImage = `url("${posterUrl(movie.p, 'w92')}")`;
    el.title = movie.t;
    el.dataset.id = movie.id;
    root.appendChild(el);
    return el;
  }

  function place(el, x, y, angle) {
    el.style.transform = `translate(${x - W / 2}px, ${y - H / 2}px) rotate(${angle}rad)`;
  }

  // Squash runs in the frame of the poster. Smear runs in the world frame, thus
  // it stretches along the direction of travel at any poster angle. Raw velocity
  // changes direction at each frame while a poster settles, which turns the
  // streak axis quickly. Ease both the quantity and the heading.
  const smear = new WeakMap();

  function smearOf(body) {
    let sm = smear.get(body);
    if (!sm) {
      if (body.speed <= SMEAR_MIN) return null;
      sm = { k: 0, dx: 0, dy: 1 };
      smear.set(body, sm);
    }
    const target = body.speed > SMEAR_MIN
      ? Math.min((body.speed - SMEAR_MIN) * SMEAR_GAIN, SMEAR_MAX)
      : 0;
    sm.k += (target - sm.k) * SMEAR_LERP;
    if (body.speed > SMEAR_MIN) {
      const inv = 1 / body.speed;
      sm.dx += (body.velocity.x * inv - sm.dx) * SMEAR_LERP;
      sm.dy += (body.velocity.y * inv - sm.dy) * SMEAR_LERP;
    }
    if (sm.k < 0.004) {
      smear.delete(body);
      return null;
    }
    return sm;
  }

  function placeBody(body, sq, sx, sy) {
    const x = body.position.x - W / 2 + sx;
    const y = body.position.y - H / 2 + sy;
    let t = `translate(${x}px, ${y}px)`;

    const sm = smearOf(body);
    if (sm) {
      const a = Math.atan2(sm.dy, sm.dx);
      t += ` rotate(${a}rad) scale(${1 + sm.k}, ${1 - sm.k}) rotate(${-a}rad)`;
    }

    t += ` rotate(${body.angle}rad)`;

    // Squash around the contact point, not the centre. Thus the side that the
    // hit strikes stays in position and the far side moves. The x axis of the
    // turned frame is the line of the hit. The poster becomes shorter along
    // that line and wider across it.
    if (sq && sq.s) {
      t += ` translate(${sq.ox}px, ${sq.oy}px) rotate(${sq.na}rad)`
        + ` scale(${1 - sq.s}, ${1 + sq.s})`
        + ` rotate(${-sq.na}rad) translate(${-sq.ox}px, ${-sq.oy}px)`;
    }
    body.el.style.transform = t;
  }

  function addBody(el, x, y, angle) {
    const body = Bodies.rectangle(x, y, W, H, {
      angle,
      density: 0.004,        // heavy enough to push its neighbours away
      restitution: 0.04,     // almost no bounce
      friction: 0.72,        // they stack and stay in a stack
      frictionAir: 0.018,
      chamfer: { radius: 2 },
    });
    body.el = el;
    Composite.add(engine.world, body);
    return body;
  }

  // Delay each drop, thus the pile falls and does not arrive in a stack. The
  // gap divides a fixed span, thus a wide screen does not wait longer than a
  // narrow screen for the same cascade.
  function drop(movies) {
    maxBodies = Math.max(maxBodies, movies.length + 30);
    const gap = clamp(DROP_SPAN / movies.length, 4, 14);

    movies.forEach((m, i) => {
      setTimeout(() => {
        const el = makeEl(m);
        const span = Math.max(120, root.clientWidth - 180);
        // The golden ratio moves across the width and does not repeat. A
        // random x put posters on each other at this rate, and they separated
        // with a jump.
        const x = 90 + ((i * 0.6180339887) % 1) * span + (Math.random() - 0.5) * 18;
        const y = -60 - Math.random() * DROP_H;
        const angle = (Math.random() - 0.5) * 2.2;
        place(el, x, y, angle);
        const body = addBody(el, clamp(x, 60, root.clientWidth - 60), y, angle);
        Body.setVelocity(body, { x: 0, y: DROP_V + Math.random() * 5 });
        items.set(m.id, { el, body });
      }, i * gap);
    });
  }

  // A poster near the surface of the settled heap, thus the change occurs where
  // nobody looks. Do not use a poster that is in the air or that just returned.
  function surfaceDonor(taken) {
    const now = performance.now();
    const floorLine = root.clientHeight * 0.45;

    function isSettledAndFree(item) {
      return item.body
        && !taken.has(item.el)
        && item.body.position.y > floorLine
        && now - (item.returnedAt ?? -Infinity) > 1200;
    }

    const free = [...items.values()].filter(isSettledAndFree);
    if (!free.length) return null;
    free.sort((a, b) => a.body.position.y - b.body.position.y);
    const top = free.slice(0, Math.max(1, Math.ceil(free.length * 0.35)));
    return top[Math.floor(Math.random() * top.length)];
  }

  // Find the film in the pile. If it is not there, use a poster near the
  // surface. Thus each pick comes out of the heap and not from off screen.
  function locate(movie, taken) {
    const found = items.get(movie.id);
    if (found) return found;

    const donor = surfaceDonor(taken);
    if (donor) {
      items.delete(Number(donor.el.dataset.id));
      donor.el.dataset.id = movie.id;
      donor.el.title = movie.t;
      donor.el.style.backgroundImage = `url("${posterUrl(movie.p, 'w92')}")`;
      items.set(movie.id, donor);
      return donor;
    }

    // Empty pile. Bring the poster in from above.
    const el = makeEl(movie);
    place(el, root.clientWidth / 2, -120, 0);
    el.getBoundingClientRect();   // write the start position before it moves
    const item = { el, body: null };
    items.set(movie.id, item);
    return item;
  }

  // Pull the poster up. It dips first, which shows effort before the climb. The
  // physics continues, thus the heap fills the gap.
  function pluck(movie, taken) {
    const item = locate(movie, taken);
    taken.add(item.el);
    if (!item.body) return item.el;

    Sleeping.set(item.body, false);
    item.el.style.zIndex = 4;
    Body.setVelocity(item.body, { x: 0, y: 2.2 });
    kickSquash(item.body, 0.1, footHit(item.body), true);

    setTimeout(() => {
      const body = item.body;
      if (!body) return;                  // it left the world during the dip
      Sleeping.set(body, false);
      Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.6, y: -12.5 });
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.09);
      kickSquash(body, -0.09, footHit(body), true);   // stretch as it leaves
    }, CROUCH);

    return item.el;
  }

  // Remove the poster from the physics world and send it to a measured box.
  function flyTo(el, box, tilt = 0) {
    const item = items.get(Number(el.dataset.id));
    if (item?.body) {
      Composite.remove(engine.world, item.body);
      item.body = null;
    }
    el.classList.add('flying', 'picked');
    const p = root.getBoundingClientRect();

    // To remove 'flying' removes the transition, thus the hover scale is
    // immediate and cannot follow the pointer.
    el.addEventListener('transitionend', function land(ev) {
      if (ev.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', land);
      el.classList.remove('flying');
      el.style.zIndex = '';        // permit the hover rule to lift it
    });

    requestAnimationFrame(() => {
      el.style.transform = `translate(${box.left - p.left}px, ${box.top - p.top}px) `
        + `rotate(${tilt}rad) scale(var(--sx), var(--sy))`;
    });
  }

  function bodyCount() {
    return [...items.values()].filter((i) => i.body).length;
  }

  // Return a poster to the pile. It falls from its current position, and the
  // first hard landing pushes the heap away.
  function dropBack(id) {
    const item = items.get(id);
    if (!item || item.body) return;
    const r = item.el.getBoundingClientRect();
    const p = root.getBoundingClientRect();
    const x = r.left - p.left + r.width / 2;
    const y = r.top - p.top + r.height / 2;

    item.el.classList.remove('flying', 'picked');
    item.el.style.zIndex = '';
    item.el.style.removeProperty('anchor-name');
    item.el.onclick = null;
    item.el.onpointerenter = null;
    item.el.onpointerleave = null;
    place(item.el, x, y, 0);

    if (bodyCount() >= maxBodies) {   // prevent continuous growth of the pile
      item.el.remove();
      items.delete(id);
      return;
    }
    item.returnedAt = performance.now();
    item.body = addBody(item.el, x, y, (Math.random() - 0.5) * 0.8);
    item.body.wave = true;
    Body.setVelocity(item.body, { x: (Math.random() - 0.5) * 3, y: 1 });
    Body.setAngularVelocity(item.body, (Math.random() - 0.5) * 0.2);
  }

  // One transform write for each body at each frame. Skip a sleeping body,
  // unless its spring still rings or the screen shakes.
  (function sync() {
    // A swing that decays, not random noise. Noise looks like jitter. A swing
    // looks like a hit.
    let sx = 0;
    let sy = 0;
    if (shake > 0.04) {
      shakePhase += 0.9;
      sx = Math.cos(shakePhase) * shake;
      sy = Math.sin(shakePhase * 1.7) * shake * 0.6;
      shake *= SHAKE_D;
    } else {
      shake = 0;
      shakePhase = 0;
    }

    for (const body of Composite.allBodies(engine.world)) {
      if (!body.el) continue;

      const sq = squash.get(body);
      if (sq) {
        sq.v = (sq.v - SQUASH_K * sq.s) * SQUASH_D;
        sq.s += sq.v;
        if (Math.abs(sq.s) < SQUASH_REST && Math.abs(sq.v) < SQUASH_REST) {
          squash.delete(body);
          sq.s = 0;
        }
      }
      if (body.isSleeping && !sq && !shake) continue;
      placeBody(body, sq, sx, sy);
    }
    requestAnimationFrame(sync);
  }());

  // Follow the window as you drag it. The positions scale with the width, thus
  // a wider window spreads the pile and a narrower window packs it higher.
  function reflow() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === size.w && h === size.h) return;
    const scale = w / size.w;
    size = { w, h };

    for (const item of items.values()) {
      const body = item.body;
      if (!body) continue;
      const x = clamp(body.position.x * scale, W * 0.6, w - W * 0.6);
      const y = Math.min(body.position.y, h - H * 0.5);
      Body.setPosition(body, { x, y });
      Body.setVelocity(body, { x: 0, y: 0 });
      Sleeping.set(body, false);   // let the full pile settle again
    }
    buildWalls();
  }

  let queued = false;
  addEventListener('resize', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; reflow(); });
  });

  return { drop, pluck, flyTo, dropBack, YANK };
}
