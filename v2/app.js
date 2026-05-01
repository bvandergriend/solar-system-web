// =====================================================================
// Solar System Explorer — application core
// =====================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ── State ──────────────────────────────────────────────────────────────
const state = {
  // Time
  date: new Date(),                 // current simulated UTC datetime
  speed: 0,                         // log10 days/second
  playing: false,

  // Camera
  center: { x: 0, y: 0, z: 0 },     // world point at screen centre (AU)
  yaw: 0, tilt: 0.4,                // radians
  zoom: 12,                         // pixels per AU

  // Interaction
  drag: null,                       // { x, y, kind: "rotate"|"pan", ... }
  hovered: null,                    // body id under cursor
  selected: null,                   // body id selected (info panel open)
  tracking: null,                   // body id being tracked

  // Toggles
  showOrbits: true,
  showTrails: true,
  showLabels: true,
  showBelts:  true,
  showZodiac: false,
  showMoons:  true,

  // Trails (id -> array of {x,y,z})
  trails: new Map(),

  // Tour
  tourStep: -1,

  // Cached belts (deterministic so they don't shimmer between frames)
  asteroidBelt: makeAsteroidBelt(),
  kuiperBelt:   makeKuiperBelt(),

  // Last time tick ran in real seconds, for speed integration
  lastT: null,
};

// ── DOM ────────────────────────────────────────────────────────────────
const sky = document.getElementById("sky");
const ctx = sky.getContext("2d");
let W = 0, H = 0, CX = 0, CY = 0;

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  W = window.innerWidth;
  H = window.innerHeight;
  sky.width  = W * dpr;
  sky.height = H * dpr;
  sky.style.width  = W + "px";
  sky.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CX = W / 2;
  CY = H / 2;
}
window.addEventListener("resize", resize);
resize();

// ── Kepler orbital mechanics ───────────────────────────────────────────
function solveKepler(M, e) {
  M = ((M % TAU) + TAU) % TAU;
  let E = M + e * Math.sin(M);
  for (let n = 0; n < 30; n++) {
    const f  = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// Heliocentric ecliptic position at `days` since J2000 from Standish
// elements (a, e, i, L, lp/=ϖ, on/=Ω). Returns {x, y, z} in AU.
function heliocentric(el, days) {
  const a = el.a, e = el.e;
  const inc = el.i  * DEG;
  const ω   = (el.lp - el.on) * DEG;     // argument of perihelion
  const Ω   = el.on * DEG;
  const M0  = (el.L  - el.lp) * DEG;     // mean anomaly at J2000
  const period = 365.25 * Math.pow(a, 1.5);
  const n = TAU / period;                // rad/day (Kepler's 3rd law)
  const M = M0 + n * days;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const ν = 2 * Math.atan2(Math.sqrt(1+e) * Math.sin(E/2),
                           Math.sqrt(1-e) * Math.cos(E/2));
  const r = a * (1 - e * cosE);
  const xo = r * Math.cos(ν);
  const yo = r * Math.sin(ν);

  // Rotate orbital plane → ecliptic (Murray & Dermott §2.8)
  const cω = Math.cos(ω), sω = Math.sin(ω);
  const cΩ = Math.cos(Ω), sΩ = Math.sin(Ω);
  const ci = Math.cos(inc), si = Math.sin(inc);
  const x = (cΩ * cω - sΩ * sω * ci) * xo + (-cΩ * sω - sΩ * cω * ci) * yo;
  const y = (sΩ * cω + cΩ * sω * ci) * xo + (-sΩ * sω + cΩ * cω * ci) * yo;
  const z = (sω * si)               * xo + ( cω * si)              * yo;
  return { x, y, z };
}

// Moon position (heliocentric) — circular orbit around its parent.
function moonPosition(parentPos, moon, days) {
  const orbitR_AU = moon.orbitR_km / AU_KM;
  const M = (moon.epoch_M * DEG) + (TAU / moon.period_d) * days;
  // Lay the orbit in the ecliptic for simplicity. Moons' real orbital
  // planes are slightly tilted; at our zoom it doesn't matter.
  return {
    x: parentPos.x + orbitR_AU * Math.cos(M),
    y: parentPos.y + orbitR_AU * Math.sin(M),
    z: parentPos.z,
  };
}

// ── Time helpers ───────────────────────────────────────────────────────
function daysSinceJ2000(d) { return (d.getTime() - J2000_MS) / 86400000; }

// ── Camera projection ──────────────────────────────────────────────────
// Apply tracking (so the tracked body stays at the screen centre), then
// translate by -center, rotate (yaw around z, tilt around x), scale.
function project(p) {
  let x = p.x - state.center.x;
  let y = p.y - state.center.y;
  let z = p.z - state.center.z;

  const cy = Math.cos(state.yaw),  sy = Math.sin(state.yaw);
  const ct = Math.cos(state.tilt), st = Math.sin(state.tilt);

  // yaw around z
  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  // tilt around x
  const y2 = y1 * ct - z * st;
  const z2 = y1 * st + z * ct;

  return {
    sx: CX + x1 * state.zoom,
    sy: CY - y2 * state.zoom,
    depth: z2,
  };
}

// ── Body lookup tables ─────────────────────────────────────────────────
// Combine all ecliptic-plane bodies for iteration. id is unique.
const ALL_BODIES = [...PLANETS, ...DWARFS, ...COMETS];

function bodyById(id) {
  for (const b of ALL_BODIES) if (b.id === id) return b;
  for (const parent in MOONS)
    for (const m of MOONS[parent])
      if (m.id === id) return Object.assign({ parent }, m);
  return null;
}

// Compute current position of any body (planet, dwarf, comet, moon).
function bodyPos(body, days) {
  if (body.parent) {
    const parentBody = bodyById(body.parent);
    return moonPosition(bodyPos(parentBody, days), body, days);
  }
  return heliocentric(body.elements, days);
}

// ── Drawing ────────────────────────────────────────────────────────────
function clear() {
  // Subtle radial gradient backdrop
  const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, Math.max(W, H) * 0.7);
  g.addColorStop(0,   "#02050f");
  g.addColorStop(0.6, "#01020a");
  g.addColorStop(1,   "#000005");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ── Stars (procedural starfield, fixed in screen space) ────────────────
const STARS = (() => {
  const s = [];
  let r = 1234567;
  const rand = () => (r = (r * 1664525 + 1013904223) >>> 0) / 0x100000000;
  for (let i = 0; i < 600; i++) {
    s.push({ x: rand(), y: rand(), b: 60 + Math.floor(rand() * 180),
             tw: rand() * TAU, sz: rand() < 0.85 ? 1 : 2 });
  }
  return s;
})();

function drawStars(t) {
  for (const s of STARS) {
    const tw = 0.7 + 0.3 * Math.sin(t * 0.0008 + s.tw);
    const v = Math.floor(s.b * tw);
    const hex = v.toString(16).padStart(2, "0");
    ctx.fillStyle = "#" + hex + hex + hex;
    ctx.fillRect(s.x * W | 0, s.y * H | 0, s.sz, s.sz);
  }
}

// ── Zodiac overlay ─────────────────────────────────────────────────────
// Drawn as a fixed-radius "celestial sphere" in world space — far enough
// out that the planets sit inside it.
function drawZodiac() {
  if (!state.showZodiac) return;
  const R = 90;  // AU, well beyond Pluto
  ctx.save();
  ctx.lineWidth = 1;
  for (const z of ZODIAC) {
    const lon = z.lon * DEG;
    const cx = R * Math.cos(lon), cy = R * Math.sin(lon);
    const c = project({ x: cx, y: cy, z: 0 });

    // Constellation stars (a few dots near the centre)
    ctx.fillStyle = "rgba(190, 210, 255, 0.6)";
    for (const [dx, dy] of z.stars) {
      ctx.beginPath();
      ctx.arc(c.sx + dx * 3, c.sy + dy * 3, 1.5, 0, TAU);
      ctx.fill();
    }
    // Label
    ctx.fillStyle = "rgba(170, 200, 240, 0.45)";
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${z.sym} ${z.name}`, c.sx, c.sy + 22);
  }
  ctx.restore();
}

// ── Belts ──────────────────────────────────────────────────────────────
function drawBelt(belt, days, color, sz) {
  ctx.fillStyle = color;
  for (const el of belt) {
    const p = heliocentric(el, days);
    const s = project(p);
    if (s.sx < -10 || s.sx > W + 10 || s.sy < -10 || s.sy > H + 10) continue;
    ctx.fillRect(s.sx | 0, s.sy | 0, sz, sz);
  }
}

// ── Orbital ellipse (proper inclination + eccentricity) ────────────────
// Sample N points along the orbit at a fixed time-like parameter (E)
// and project each. The Sun sits at one focus of the resulting curve.
function drawOrbit(elements, color, alpha = 1, segments = 96) {
  const a = elements.a, e = elements.e;
  const inc = elements.i  * DEG;
  const ω   = (elements.lp - elements.on) * DEG;
  const Ω   = elements.on * DEG;
  const cω = Math.cos(ω), sω = Math.sin(ω);
  const cΩ = Math.cos(Ω), sΩ = Math.sin(Ω);
  const ci = Math.cos(inc), si = Math.sin(inc);

  ctx.beginPath();
  for (let k = 0; k <= segments; k++) {
    const E = (k / segments) * TAU;
    const xo = a * (Math.cos(E) - e);
    const yo = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const x  = (cΩ * cω - sΩ * sω * ci) * xo + (-cΩ * sω - sΩ * cω * ci) * yo;
    const y  = (sΩ * cω + cΩ * sω * ci) * xo + (-sΩ * sω + cΩ * cω * ci) * yo;
    const z  = (sω * si)               * xo + ( cω * si)              * yo;
    const s  = project({ x, y, z });
    if (k === 0) ctx.moveTo(s.sx, s.sy); else ctx.lineTo(s.sx, s.sy);
  }
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16),
        g = parseInt(hex.slice(3,5),16),
        b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function dim(hex, factor) {
  const r = Math.floor(parseInt(hex.slice(1,3),16) * factor);
  const g = Math.floor(parseInt(hex.slice(3,5),16) * factor);
  const b = Math.floor(parseInt(hex.slice(5,7),16) * factor);
  return `rgb(${r},${g},${b})`;
}

// ── Photorealistic textures (NASA-derived equirectangular maps) ────────
// Textures © Solar System Scope, CC-BY 4.0 — derived from public-domain
// NASA imagery (Messenger, Magellan, Viking, MOLA, Cassini, Voyager,
// Hubble, etc.). Each planet's equirectangular map is sampled into a
// circular sprite (front hemisphere visible, Lambertian lighting from
// the upper-right) once per body, then blitted each frame.
const TEXTURE_FILES = {
  Sun:     "textures/sun.jpg",
  Mercury: "textures/mercury.jpg",
  Venus:   "textures/venus.jpg",
  Earth:   "textures/earth.jpg",
  Mars:    "textures/mars.jpg",
  Jupiter: "textures/jupiter.jpg",
  Saturn:  "textures/saturn.jpg",
  Uranus:  "textures/uranus.jpg",
  Neptune: "textures/neptune.jpg",
  Pluto:   "textures/moon.jpg",     // close-enough stand-in (rocky greys)
  Moon:    "textures/moon.jpg",
};
const bodyTextures = {};   // id → HTMLImageElement (raw equirectangular)
const bodySprites  = {};   // id → off-screen <canvas> (rendered sphere)

function loadTextures() {
  return Promise.all(Object.entries(TEXTURE_FILES).map(([id, src]) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { bodyTextures[id] = img; resolve(); };
      img.onerror = () => resolve();   // missing texture → fallback to colour
      img.src = src;
    })
  ));
}

// Render an equirectangular texture onto a sphere, viewed from +z, with
// Lambertian shading. Returns an off-screen canvas with a transparent
// background outside the disc.
function renderSphereSprite(texImg, radius) {
  const OS = 3;                          // oversample for crispness
  const sz = Math.max(8, Math.floor(radius * 2 * OS));
  const cv = document.createElement("canvas");
  cv.width = sz; cv.height = sz;
  const c2 = cv.getContext("2d");

  // Pull pixel data out of the equirectangular texture.
  const tw = texImg.naturalWidth, th = texImg.naturalHeight;
  const tcv = document.createElement("canvas");
  tcv.width = tw; tcv.height = th;
  const tcx = tcv.getContext("2d");
  tcx.drawImage(texImg, 0, 0);
  const tex = tcx.getImageData(0, 0, tw, th).data;

  const out = c2.createImageData(sz, sz);
  const od  = out.data;

  // Light direction — fixed, slightly above and to the right, so every
  // planet picks up the same 3-D shading and looks like a sphere.
  const Lx = 0.45, Ly = -0.30, Lz = 0.84;   // unit vector
  const r  = sz / 2;

  for (let py = 0; py < sz; py++) {
    for (let px = 0; px < sz; px++) {
      const dx = (px - r + 0.5) / r;
      const dy = (py - r + 0.5) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const dz = Math.sqrt(1 - d2);

      // Equirectangular sampling. -dy because canvas y points down,
      // so dy<0 corresponds to the northern hemisphere of the sphere.
      const lat = Math.asin(-dy);
      const lon = Math.atan2(dx, dz);
      const u = lon / TAU + 0.5;
      const v = 0.5 - lat / Math.PI;
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)));
      const ti = (ty * tw + tx) * 4;

      // Lambertian + ambient floor so the dark side isn't pitch black.
      const lam = dx * Lx + dy * Ly + dz * Lz;
      const lit = 0.18 + 0.82 * Math.max(0, lam);

      // Soft anti-aliased edge: fade alpha in the last ~1px of the disc
      const edge = (1 - d2) > 0.04 ? 255 : Math.floor((1 - d2) * 255 / 0.04);

      const oi = (py * sz + px) * 4;
      od[oi    ] = Math.min(255, tex[ti    ] * lit);
      od[oi + 1] = Math.min(255, tex[ti + 1] * lit);
      od[oi + 2] = Math.min(255, tex[ti + 2] * lit);
      od[oi + 3] = edge;
    }
  }

  c2.putImageData(out, 0, 0);
  return cv;
}

// Render a sun sprite: equirectangular map at full brightness, no
// Lambertian shading (the Sun is self-luminous).
function renderSunSprite(texImg, radius) {
  const OS = 3;
  const sz = Math.max(8, Math.floor(radius * 2 * OS));
  const cv = document.createElement("canvas");
  cv.width = sz; cv.height = sz;
  const c2 = cv.getContext("2d");

  const tw = texImg.naturalWidth, th = texImg.naturalHeight;
  const tcv = document.createElement("canvas");
  tcv.width = tw; tcv.height = th;
  tcv.getContext("2d").drawImage(texImg, 0, 0);
  const tex = tcv.getContext("2d").getImageData(0, 0, tw, th).data;

  const out = c2.createImageData(sz, sz);
  const od  = out.data;
  const r = sz / 2;
  for (let py = 0; py < sz; py++) {
    for (let px = 0; px < sz; px++) {
      const dx = (px - r + 0.5) / r;
      const dy = (py - r + 0.5) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const dz = Math.sqrt(1 - d2);
      const lat = Math.asin(-dy);
      const lon = Math.atan2(dx, dz);
      const u = lon / TAU + 0.5, v = 0.5 - lat / Math.PI;
      const tx = Math.min(tw-1, Math.floor(u * tw));
      const ty = Math.min(th-1, Math.floor(v * th));
      const ti = (ty * tw + tx) * 4;
      // Slight limb darkening (very subtle) to give it 3-D feel
      const lim = 0.85 + 0.15 * dz;
      const edge = (1 - d2) > 0.04 ? 255 : Math.floor((1 - d2) * 255 / 0.04);
      const oi = (py * sz + px) * 4;
      od[oi    ] = Math.min(255, tex[ti    ] * lim);
      od[oi + 1] = Math.min(255, tex[ti + 1] * lim);
      od[oi + 2] = Math.min(255, tex[ti + 2] * lim);
      od[oi + 3] = edge;
    }
  }
  c2.putImageData(out, 0, 0);
  return cv;
}

function buildAllSprites() {
  // Planets / dwarfs / comet
  for (const b of ALL_BODIES) {
    const tex = bodyTextures[b.id];
    if (tex) bodySprites[b.id] = renderSphereSprite(tex, b.radius);
  }
  // Earth's Moon (only moon we have a real texture for)
  if (bodyTextures.Moon && MOONS.Earth) {
    const moon = MOONS.Earth.find(m => m.id === "Moon");
    if (moon) bodySprites.Moon = renderSphereSprite(bodyTextures.Moon, moon.radius);
  }
  // Sun — special render (no Lambertian)
  if (bodyTextures.Sun) bodySprites.Sun = renderSunSprite(bodyTextures.Sun, 12);
}

// ── The Sun ────────────────────────────────────────────────────────────
function drawSun() {
  const s = project({ x: 0, y: 0, z: 0 });
  if (s.sx < -100 || s.sx > W + 100 || s.sy < -100 || s.sy > H + 100) return;
  const grad = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, 60);
  grad.addColorStop(0,    "rgba(255, 240, 130, 1)");
  grad.addColorStop(0.18, "rgba(255, 200,  60, 0.7)");
  grad.addColorStop(0.45, "rgba(255, 130,  30, 0.25)");
  grad.addColorStop(1,    "rgba(255, 100,  20, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s.sx, s.sy, 60, 0, TAU);
  ctx.fill();

  // Photosphere — if the texture is loaded, blit the rendered sun
  // sprite (with subtle limb darkening); otherwise fall back to a flat
  // disc. The corona above is what dominates visually anyway.
  const sprite = bodySprites.Sun;
  if (sprite) {
    ctx.drawImage(sprite, s.sx - 12, s.sy - 12, 24, 24);
  } else {
    ctx.fillStyle = "#ffeebb";
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, 8, 0, TAU);
    ctx.fill();
  }

  if (state.showLabels) {
    ctx.fillStyle = "#ffeebb";
    ctx.font = "10px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("Sun", s.sx, s.sy + 22);
  }
}

// ── Trails ─────────────────────────────────────────────────────────────
const TRAIL_LEN = 80;
function pushTrail(id, p) {
  if (!state.trails.has(id)) state.trails.set(id, []);
  const arr = state.trails.get(id);
  arr.push({ x: p.x, y: p.y, z: p.z });
  if (arr.length > TRAIL_LEN) arr.shift();
}
function clearTrails() { state.trails.clear(); }

function drawTrail(id, color) {
  if (!state.showTrails) return;
  const arr = state.trails.get(id);
  if (!arr || arr.length < 2) return;
  ctx.lineWidth = 1.5;
  for (let i = 1; i < arr.length; i++) {
    const a = (i / arr.length);
    const p0 = project(arr[i - 1]);
    const p1 = project(arr[i]);
    ctx.strokeStyle = withAlpha(color, a * 0.55);
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
  }
}

// ── Bodies (planets, dwarfs, comets) ───────────────────────────────────
function drawBody(body, pos) {
  const s = project(pos);
  if (s.sx < -50 || s.sx > W + 50 || s.sy < -50 || s.sy > H + 50) return null;

  // Saturn rings — a tilted ellipse around the body
  if (body.id === "Saturn") {
    const tilt = Math.cos(state.tilt);
    ctx.strokeStyle = "#b8a060";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.sx, s.sy,
                body.radius * 2.4, Math.max(1, body.radius * 2.4 * tilt),
                0, 0, TAU);
    ctx.stroke();
  }

  // Comet tail: points from Sun outward, length scales with proximity.
  if (body.isComet) {
    drawCometTail(pos, s);
  }

  // Subtle glow halo (colour-tinted) around every body, drawn first.
  const grad = ctx.createRadialGradient(s.sx, s.sy, body.radius * 0.9,
                                        s.sx, s.sy, body.radius * 2);
  grad.addColorStop(0, withAlpha(body.color, 0.35));
  grad.addColorStop(1, withAlpha(body.color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s.sx, s.sy, body.radius * 2, 0, TAU);
  ctx.fill();

  // Body itself: textured sphere sprite if the image is loaded,
  // otherwise the original flat-coloured disc as a fallback.
  const sprite = bodySprites[body.id];
  if (sprite) {
    ctx.drawImage(sprite, s.sx - body.radius, s.sy - body.radius,
                          body.radius * 2,    body.radius * 2);
  } else {
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, body.radius, 0, TAU);
    ctx.fill();
  }

  if (state.selected === body.id || state.tracking === body.id) {
    ctx.strokeStyle = state.tracking === body.id ? "#ff9a40" : "#79c0ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, body.radius + 6, 0, TAU);
    ctx.stroke();
  }

  if (state.showLabels) {
    ctx.fillStyle = state.hovered === body.id ? "#ffffff" : "#aab8d6";
    ctx.font = state.hovered === body.id ? "bold 11px Arial" : "10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(body.id, s.sx, s.sy + body.radius + 14);
  }

  return s;
}

function drawCometTail(pos, screenPos) {
  // Tail length grows as the comet approaches the Sun (1/r^1.5)
  const r = Math.hypot(pos.x, pos.y, pos.z);
  const baseLen = 80 / Math.pow(Math.max(1, r), 0.6);
  // Direction from Sun → comet (i.e., outward), projected.
  const sunS = project({ x: 0, y: 0, z: 0 });
  let dx = screenPos.sx - sunS.sx, dy = screenPos.sy - sunS.sy;
  const m = Math.hypot(dx, dy) || 1;
  dx /= m; dy /= m;

  // Two-tone tail (ion + dust)
  const layers = [
    { len: baseLen * 1.2, w: 2, color: "rgba(140, 220, 255, 0.55)" },
    { len: baseLen,       w: 4, color: "rgba(255, 220, 180, 0.30)" },
  ];
  for (const L of layers) {
    const grad = ctx.createLinearGradient(
      screenPos.sx, screenPos.sy,
      screenPos.sx + dx * L.len, screenPos.sy + dy * L.len);
    grad.addColorStop(0, L.color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = L.w;
    ctx.beginPath();
    ctx.moveTo(screenPos.sx, screenPos.sy);
    ctx.lineTo(screenPos.sx + dx * L.len, screenPos.sy + dy * L.len);
    ctx.stroke();
  }
}

// ── Moons (drawn relative to their planet, only when zoomed enough) ────
function drawMoons(parentBody, parentPos, days) {
  if (!state.showMoons) return;
  const moons = MOONS[parentBody.id];
  if (!moons) return;
  // Threshold: only draw moons when the parent's largest moon orbit
  // would project to more than ~6 px on screen.
  const biggest = Math.max(...moons.map(m => m.orbitR_km / AU_KM));
  if (biggest * state.zoom < 4) return;

  for (const m of moons) {
    const p  = moonPosition(parentPos, m, days);
    const sp = project(p);
    if (sp.sx < -20 || sp.sx > W + 20 || sp.sy < -20 || sp.sy > H + 20) continue;

    // Faint orbit ring
    const tilt = Math.cos(state.tilt);
    const orbitR = (m.orbitR_km / AU_KM) * state.zoom;
    if (orbitR > 6) {
      const ps = project(parentPos);
      ctx.strokeStyle = "rgba(160, 180, 220, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(ps.sx, ps.sy, orbitR, Math.max(1, orbitR * tilt), 0, 0, TAU);
      ctx.stroke();
    }

    const moonSprite = bodySprites[m.id];
    if (moonSprite) {
      ctx.drawImage(moonSprite, sp.sx - m.radius, sp.sy - m.radius,
                                m.radius * 2,     m.radius * 2);
    } else {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(sp.sx, sp.sy, m.radius, 0, TAU);
      ctx.fill();
    }

    if (state.selected === m.id || state.tracking === m.id) {
      ctx.strokeStyle = state.tracking === m.id ? "#ff9a40" : "#79c0ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.sx, sp.sy, m.radius + 4, 0, TAU);
      ctx.stroke();
    }

    if (state.showLabels && orbitR > 12) {
      ctx.fillStyle = state.hovered === m.id ? "#ffffff" : "#8aa1c4";
      ctx.font = "9px Arial";
      ctx.textAlign = "center";
      ctx.fillText(m.id, sp.sx, sp.sy + m.radius + 10);
    }
  }
}

// ── Scale bar ──────────────────────────────────────────────────────────
function drawScaleBar() {
  // Pick a "nice" round AU value that fits roughly 110px on screen.
  const targetPx = 140;
  const targetAU = targetPx / state.zoom;
  const niceAU = niceRound(targetAU);
  const px = niceAU * state.zoom;
  const x0 = 24, y0 = H - 56;
  ctx.strokeStyle = "#a8b8d6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);  ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
  ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
  ctx.stroke();
  ctx.fillStyle = "#c2cfe6";
  ctx.font = "11px 'Courier New', monospace";
  ctx.textAlign = "left";
  ctx.fillText(formatAU(niceAU), x0, y0 - 8);
}

function niceRound(v) {
  // Round to 1, 2, 5 × 10^n
  if (v <= 0) return 1;
  const p10 = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p10;
  const r = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7 ? 5 : 10;
  return r * p10;
}

function formatAU(v) {
  if (v >= 1) return v + " AU";
  if (v >= 0.01) return v.toFixed(2) + " AU";
  return (v * AU_KM | 0).toLocaleString() + " km";
}

// ── HUD ────────────────────────────────────────────────────────────────
const hudDate = document.getElementById("hud-date");
const hudMeta = document.getElementById("hud-meta");
const hudZoom = document.getElementById("hud-zoom");

function updateHUD() {
  const d = state.date;
  const months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"];
  const pad = n => n.toString().padStart(2, "0");
  hudDate.textContent =
    `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

  let speedStr;
  if (!state.playing) speedStr = "paused";
  else {
    const dps = Math.pow(10, state.speed) * state.speedSign;
    speedStr = formatSpeed(dps);
  }
  hudMeta.textContent =
    state.tracking ? `tracking ${state.tracking}  ·  ${speedStr}`
                   : `time speed: ${speedStr}`;
  hudZoom.textContent = `zoom: ${state.zoom.toFixed(1)} px / AU`;
}

function formatSpeed(dps) {
  const abs = Math.abs(dps);
  const sign = dps < 0 ? "-" : "";
  if (abs < 1)              return sign + (abs * 24).toFixed(2) + " hr/sec";
  if (abs < 365)            return sign + abs.toFixed(2) + " day/sec";
  if (abs < 365 * 100)      return sign + (abs / 365.25).toFixed(2) + " yr/sec";
  return sign + (abs / 365.25).toExponential(1) + " yr/sec";
}

// ── Animation loop ─────────────────────────────────────────────────────
function frame(t) {
  // Advance time
  if (state.lastT !== null && state.playing) {
    const dt = (t - state.lastT) / 1000;          // real seconds
    const sign = state.speedSign || 1;
    const dps  = Math.pow(10, state.speed) * sign;
    state.date = new Date(state.date.getTime() + dt * dps * 86400 * 1000);
  }
  state.lastT = t;

  const days = daysSinceJ2000(state.date);

  // If tracking a body, lock camera centre to its position.
  if (state.tracking) {
    const tb = bodyById(state.tracking);
    if (tb) state.center = bodyPos(tb, days);
  }

  clear();
  drawStars(t);
  drawZodiac();

  if (state.showBelts) {
    drawBelt(state.asteroidBelt, days, "rgba(150, 130, 100, 0.55)", 1);
    drawBelt(state.kuiperBelt,   days, "rgba(140, 170, 200, 0.45)", 1);
  }

  // Compute current positions for the main bodies
  const positions = new Map();
  for (const b of ALL_BODIES) positions.set(b.id, heliocentric(b.elements, days));

  // Update trails (subsample to avoid burning when fast-forwarding huge)
  for (const [id, p] of positions) pushTrail(id, p);

  // Orbits behind the Sun
  if (state.showOrbits) {
    for (const b of ALL_BODIES) {
      drawOrbit(b.elements, b.color, b.isComet ? 0.55 : 0.32);
    }
  }

  drawSun();

  // Sort bodies by depth (back-to-front)
  const drawList = ALL_BODIES.map(b => ({ b, pos: positions.get(b.id),
                                           depth: project(positions.get(b.id)).depth }));
  drawList.sort((a, c) => c.depth - a.depth);

  for (const { b, pos } of drawList) {
    drawTrail(b.id, b.color);
    drawBody(b, pos);
    drawMoons(b, pos, days);
  }

  drawScaleBar();
  updateHUD();

  requestAnimationFrame(frame);
}

// ── Hit-testing ────────────────────────────────────────────────────────
function bodyAt(x, y, days) {
  const all = [];
  for (const b of ALL_BODIES) {
    const p = heliocentric(b.elements, days);
    const s = project(p);
    all.push({ id: b.id, body: b, sx: s.sx, sy: s.sy, r: b.radius });
    if (state.showMoons && MOONS[b.id]) {
      for (const m of MOONS[b.id]) {
        const mp = moonPosition(p, m, days);
        const ms = project(mp);
        const orbitR = (m.orbitR_km / AU_KM) * state.zoom;
        if (orbitR < 4) continue;
        all.push({ id: m.id, body: Object.assign({ parent: b.id }, m),
                   sx: ms.sx, sy: ms.sy, r: m.radius });
      }
    }
  }
  let best = null, bestD = Infinity;
  for (const item of all) {
    const d = Math.hypot(item.sx - x, item.sy - y);
    const hit = item.r + 8;
    if (d < hit && d < bestD) { best = item; bestD = d; }
  }
  return best ? best.id : null;
}

// ── Input — mouse + touch ──────────────────────────────────────────────
function getXY(e) {
  const rect = sky.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

sky.addEventListener("mousedown", e => {
  const { x, y } = getXY(e);
  state.drag = {
    x0: x, y0: y, x: x, y: y,
    yaw0: state.yaw, tilt0: state.tilt,
    cx0: state.center.x, cy0: state.center.y,
    kind: e.shiftKey ? "pan" : "rotate",
    moved: false,
  };
});
window.addEventListener("mousemove", e => {
  const { x, y } = getXY(e);
  if (state.drag) {
    const dx = x - state.drag.x0, dy = y - state.drag.y0;
    if (Math.hypot(dx, dy) > 3) state.drag.moved = true;
    if (state.drag.kind === "rotate") {
      const SENS = 0.006;
      state.yaw  = state.drag.yaw0 + dx * SENS;
      state.tilt = Math.max(0, Math.min(Math.PI/2 - 0.01,
                                        state.drag.tilt0 + dy * SENS));
    } else {
      // Pan in screen-aligned axes, transformed back to world
      const sx = -dx / state.zoom;
      const sy =  dy / state.zoom;
      const cy = Math.cos(state.yaw), sN = Math.sin(state.yaw);
      state.center.x = state.drag.cx0 + cy * sx + sN * sy;
      state.center.y = state.drag.cy0 - sN * sx + cy * sy;
      // Disable tracking when user pans manually
      if (state.tracking) state.tracking = null;
    }
    state.drag.x = x; state.drag.y = y;
  } else {
    state.hovered = bodyAt(x, y, daysSinceJ2000(state.date));
    sky.style.cursor = state.hovered ? "pointer" : "grab";
  }
});
window.addEventListener("mouseup", e => {
  if (state.drag && !state.drag.moved) {
    const { x, y } = getXY(e);
    const id = bodyAt(x, y, daysSinceJ2000(state.date));
    select(id);
  }
  state.drag = null;
});

sky.addEventListener("wheel", e => {
  e.preventDefault();
  const { x, y } = getXY(e);
  // Zoom about the cursor position, not the canvas centre — feels
  // like a real map.
  const factor = Math.exp(-e.deltaY * 0.0015);
  // World point under cursor before zoom:
  const dx = (x - CX) / state.zoom;
  const dy = (CY - y) / state.zoom;
  const cy = Math.cos(state.yaw), sn = Math.sin(state.yaw);
  const wx0 = state.center.x + cy * dx + sn * dy;
  const wy0 = state.center.y - sn * dx + cy * dy;
  state.zoom = Math.max(0.1, Math.min(20000, state.zoom * factor));
  // World point should still be under cursor → recompute centre.
  const dx1 = (x - CX) / state.zoom;
  const dy1 = (CY - y) / state.zoom;
  state.center.x = wx0 - (cy * dx1 + sn * dy1);
  state.center.y = wy0 - (-sn * dx1 + cy * dy1);
}, { passive: false });

// Touch: one finger rotates, two fingers pinch-zoom + pan.
let lastTouch = null;
sky.addEventListener("touchstart", e => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const r = sky.getBoundingClientRect();
    state.drag = {
      x0: t.clientX - r.left, y0: t.clientY - r.top,
      yaw0: state.yaw, tilt0: state.tilt, kind: "rotate", moved: false,
    };
  } else if (e.touches.length === 2) {
    state.drag = null;
    const a = e.touches[0], b = e.touches[1];
    lastTouch = { dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
                  cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  }
  e.preventDefault();
}, { passive: false });
sky.addEventListener("touchmove", e => {
  if (e.touches.length === 1 && state.drag) {
    const t = e.touches[0];
    const r = sky.getBoundingClientRect();
    const dx = (t.clientX - r.left) - state.drag.x0;
    const dy = (t.clientY - r.top)  - state.drag.y0;
    state.yaw = state.drag.yaw0 + dx * 0.006;
    state.tilt = Math.max(0, Math.min(Math.PI/2 - 0.01,
                                       state.drag.tilt0 + dy * 0.006));
  } else if (e.touches.length === 2 && lastTouch) {
    const a = e.touches[0], b = e.touches[1];
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const factor = dist / lastTouch.dist;
    state.zoom = Math.max(0.1, Math.min(20000, state.zoom * factor));
    lastTouch.dist = dist;
  }
  e.preventDefault();
}, { passive: false });
sky.addEventListener("touchend", () => { state.drag = null; lastTouch = null; });

// ── Selection / Tracking ───────────────────────────────────────────────
const infoEl       = document.getElementById("info");
const infoName     = document.getElementById("info-name");
const infoType     = document.getElementById("info-type");
const infoTable    = document.getElementById("info-table");
const infoFact     = document.getElementById("info-fact");
const infoTrackBtn = document.getElementById("info-track");

document.getElementById("info-close").addEventListener("click", () => {
  state.selected = null;
  infoEl.classList.add("hidden");
});

infoTrackBtn.addEventListener("click", () => {
  if (state.tracking === state.selected) {
    state.tracking = null;
  } else {
    state.tracking = state.selected;
  }
  refreshInfoPanel();
});

function select(id) {
  state.selected = id;
  if (!id) { infoEl.classList.add("hidden"); return; }
  refreshInfoPanel();
  infoEl.classList.remove("hidden");
}

function refreshInfoPanel() {
  if (!state.selected) return;
  const body = bodyById(state.selected);
  if (!body) return;
  infoName.textContent = body.id;
  infoType.textContent = body.facts && body.facts.type
                         ? body.facts.type : "";
  infoTrackBtn.textContent = state.tracking === body.id
                             ? "Stop tracking" : "Track this body";
  infoTrackBtn.classList.toggle("tracking", state.tracking === body.id);

  const days = daysSinceJ2000(state.date);
  const pos  = bodyPos(body, days);
  const earth = bodyPos(bodyById("Earth"), days);

  const dist_AU  = Math.hypot(pos.x - earth.x, pos.y - earth.y, pos.z - earth.z);
  const dist_sun = body.parent ? null : Math.hypot(pos.x, pos.y, pos.z);
  const lt_min   = (dist_AU * AU_KM) / C_KMS / 60;

  const f = body.facts || {};
  const rows = [];
  if (f.diameter) rows.push(["Diameter",  `${f.diameter.toLocaleString()} km`]);
  if (f.mass !== null && f.mass !== undefined) {
    rows.push(["Mass",
      f.mass < 0.001
        ? `${(f.mass * 5.972e24).toExponential(2)} kg`
        : `${f.mass.toFixed(3)} Earth`]);
  }
  if (f.gravity !== null && f.gravity !== undefined) {
    rows.push(["Surface gravity", `${f.gravity.toFixed(2)} m/s²`]);
    rows.push(["Your weight here",
      `${(70 * f.gravity / G_EARTH_GRAV).toFixed(1)} kg (if 70 kg on Earth)`]);
  }
  if (f.day !== null && f.day !== undefined) {
    rows.push(["Day length",
      f.day < 1 ? `${(f.day * 24).toFixed(1)} h` : `${f.day.toFixed(2)} Earth days`]);
  }
  if (f.year !== null && f.year !== undefined) {
    rows.push(["Year length",
      f.year < 365.25 ? `${f.year.toFixed(2)} Earth days`
                      : `${(f.year / 365.25).toFixed(2)} Earth years`]);
  }
  if (f.tempC !== null && f.tempC !== undefined)
    rows.push(["Avg surface temp", `${f.tempC > 0 ? "+" : ""}${f.tempC} °C`]);
  if (f.moons !== null && f.moons !== undefined)
    rows.push(["Known moons", f.moons]);
  if (f.magnitude !== null && f.magnitude !== undefined && body.id !== "Earth")
    rows.push(["Apparent mag.", f.magnitude.toFixed(2)]);

  if (dist_sun !== null) rows.push(["Distance from Sun",  `${dist_sun.toFixed(3)} AU`]);
  if (body.id !== "Earth")
    rows.push(["Distance from Earth", `${dist_AU.toFixed(3)} AU`]);
  if (body.id !== "Earth")
    rows.push(["Light travel time",
      lt_min < 1 ? `${(lt_min * 60).toFixed(1)} sec`
                 : lt_min < 60 ? `${lt_min.toFixed(2)} min`
                                : `${(lt_min / 60).toFixed(2)} hr`]);

  infoTable.innerHTML = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join("");
  infoFact.textContent = f.fact || "";
}

// ── Toggles ────────────────────────────────────────────────────────────
function bindToggle(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => { state[key] = el.checked; });
}
bindToggle("t-orbits", "showOrbits");
bindToggle("t-trails", "showTrails");
bindToggle("t-labels", "showLabels");
bindToggle("t-belts",  "showBelts");
bindToggle("t-zodiac", "showZodiac");
bindToggle("t-moons",  "showMoons");

// ── Time UI ────────────────────────────────────────────────────────────
const datePicker = document.getElementById("date-picker");
const speedEl    = document.getElementById("speed");
const speedLbl   = document.getElementById("speed-label");
const eventsEl   = document.getElementById("events");

// A small dead-band at slider centre so it's easy to land on "paused"
// without micrometer precision. Outside this band the speed grows
// logarithmically: at the band edge it's 1 day/sec, at full deflection
// (±6) it's about 10⁵·⁸ days/sec ≈ 1700 yr/sec.
const SPEED_DEADBAND = 0.2;

function syncDatePicker() {
  const d = state.date;
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  datePicker.value = `${yyyy}-${mm}-${dd}`;
}
syncDatePicker();
setInterval(syncDatePicker, 500);  // keep in sync as the simulation runs

datePicker.addEventListener("change", () => {
  if (datePicker.value) {
    state.date = new Date(datePicker.value + "T12:00:00Z");
    clearTrails();
  }
});
document.getElementById("now-btn").addEventListener("click", () => {
  state.date = new Date();
  clearTrails();
});

state.speedSign = 1;
function updateSpeedLabel() {
  if (!state.playing) {
    speedLbl.textContent = "paused";
    speedLbl.classList.add("paused");
    return;
  }
  const dps = Math.pow(10, state.speed) * state.speedSign;
  speedLbl.textContent = formatSpeed(dps);
  speedLbl.classList.remove("paused");
}
function applySpeedSlider(v) {
  if (Math.abs(v) < SPEED_DEADBAND) {
    state.playing = false;
    state.speed   = 0;
  } else {
    const mag = Math.abs(v) - SPEED_DEADBAND;
    state.speed     = mag;
    state.speedSign = v < 0 ? -1 : 1;
    if (!state.playing) state.lastT = null;  // reset clock on resume
    state.playing   = true;
  }
  updateSpeedLabel();
}
speedEl.addEventListener("input", () => applySpeedSlider(parseFloat(speedEl.value)));
// Snap to exact zero when the user releases the thumb inside the dead-
// band: makes "park at paused" feel detent-like without affecting the
// continuous response while dragging.
function snapToCentre() {
  if (Math.abs(parseFloat(speedEl.value)) < SPEED_DEADBAND) {
    speedEl.value = 0;
    applySpeedSlider(0);
  }
}
speedEl.addEventListener("change",     snapToCentre);
speedEl.addEventListener("mouseup",    snapToCentre);
speedEl.addEventListener("touchend",   snapToCentre);
speedEl.addEventListener("keyup",      snapToCentre);

// Build events dropdown
for (const ev of EVENTS) {
  const o = document.createElement("option");
  o.value = ev.date;
  o.textContent = `${ev.date.slice(0, 10)} — ${ev.label}`;
  eventsEl.appendChild(o);
}
eventsEl.addEventListener("change", () => {
  if (eventsEl.value) {
    state.date = new Date(eventsEl.value);
    clearTrails();
    eventsEl.selectedIndex = 0;
  }
});

// Reset view
document.getElementById("reset-view").addEventListener("click", () => {
  state.center = { x: 0, y: 0, z: 0 };
  state.yaw    = 0;
  state.tilt   = 0.4;
  state.zoom   = 12;
  state.tracking = null;
  if (state.selected) refreshInfoPanel();
});

// ── Tour ───────────────────────────────────────────────────────────────
const tourEl       = document.getElementById("tour");
const tourStepEl   = document.getElementById("tour-step");
const btnTourStart = document.getElementById("tour-start");
const btnTourPrev  = document.getElementById("tour-prev");
const btnTourNext  = document.getElementById("tour-next");
const btnTourEnd   = document.getElementById("tour-end");

function showTourStep(n) {
  state.tourStep = Math.max(0, Math.min(TOUR.length - 1, n));
  const s = TOUR[state.tourStep];
  tourStepEl.innerHTML = `<h3>${s.title}</h3><p>${s.body}</p>`;
  btnTourPrev.style.visibility = state.tourStep === 0 ? "hidden" : "visible";
  btnTourNext.textContent = state.tourStep === TOUR.length - 1
                            ? "Done" : "Next ›";
  applyTourAction(s.action || {});
}
function applyTourAction(a) {
  if (a.reset) {
    state.center = { x: 0, y: 0, z: 0 };
    state.yaw  = 0;
    state.tilt = 0.4;
    state.zoom = 12;
    state.tracking = null;
  }
  if ("zoom" in a) state.zoom = a.zoom;
  if ("track" in a) state.tracking = a.track;
  if (a.toggle) {
    for (const k in a.toggle) {
      const map = { belts: "showBelts", orbits: "showOrbits",
                    trails: "showTrails", zodiac: "showZodiac",
                    moons: "showMoons", labels: "showLabels" };
      const stateKey = map[k];
      if (stateKey) {
        state[stateKey] = a.toggle[k];
        const checkbox = document.querySelector(`#t-${k}`);
        if (checkbox) checkbox.checked = a.toggle[k];
      }
    }
  }
  if (a.jumpDate) {
    state.date = new Date(a.jumpDate + "T12:00:00Z");
    clearTrails();
  }
}
btnTourStart.addEventListener("click", () => {
  tourEl.classList.remove("hidden");
  showTourStep(0);
});
btnTourPrev.addEventListener("click", () => showTourStep(state.tourStep - 1));
btnTourNext.addEventListener("click", () => {
  if (state.tourStep === TOUR.length - 1) tourEl.classList.add("hidden");
  else showTourStep(state.tourStep + 1);
});
btnTourEnd.addEventListener("click", () => tourEl.classList.add("hidden"));

// Hide first-load hint after a few seconds
setTimeout(() => document.getElementById("help").classList.add("fade"), 8000);

requestAnimationFrame(frame);

// Kick off texture loading — when the images arrive we generate their
// sphere sprites, and drawSun/drawBody pick them up automatically on
// the next frame. The animation loop runs immediately in fallback
// (flat-colour) mode so the page is usable while textures download.
loadTextures().then(buildAllSprites);
