// ─── Solar System Live Viewer (web) ────────────────────────────────────
// Pure-vanilla JS port of solar_system.py. Matches the Python version's
// astronomical model and visual layout. No build step, no dependencies.
// ────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Mean longitude at J2000.0 (Jan 1.5 2000), degrees
const MEAN_LONGITUDES = {
  Mercury: 252.2507, Venus: 181.9798, Earth: 100.4664, Mars: 355.4333,
  Jupiter: 34.3515,  Saturn: 50.0775, Uranus: 314.0550, Neptune: 304.3487,
};
// Sidereal orbital period (days)
const ORBITAL_PERIODS = {
  Mercury: 87.97, Venus: 224.70, Earth: 365.25, Mars: 686.97,
  Jupiter: 4332.59, Saturn: 10759.22, Uranus: 30688.50, Neptune: 60182.00,
};
// [display orbit radius, body radius, fill colour]
const PLANET_DISPLAY = {
  Mercury: [50,   4, "#a0a0a0"],
  Venus:   [82,   7, "#e8cda0"],
  Earth:   [120,  8, "#4fa3e0"],
  Mars:    [160,  5, "#c1440e"],
  Jupiter: [220, 16, "#c88b3a"],
  Saturn:  [275, 13, "#e4d191"],
  Uranus:  [325, 10, "#7de8e8"],
  Neptune: [370,  9, "#4b70dd"],
};

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

function dim(hex, factor) {
  const r = Math.max(0x14, Math.floor(parseInt(hex.slice(1, 3), 16) * factor));
  const g = Math.max(0x10, Math.floor(parseInt(hex.slice(3, 5), 16) * factor));
  const b = Math.max(0x14, Math.floor(parseInt(hex.slice(5, 7), 16) * factor));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// Tk Canvas arcs measure CCW from 3 o'clock; HTML Canvas measures CW.
// This helper draws a pie slice using the same (start, extent) degrees
// the Python code uses, so the conversion stays in one place.
function tkPieSlice(ctx, x, y, r, startDeg, extentDeg) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, -startDeg * DEG, -(startDeg + extentDeg) * DEG, true);
  ctx.closePath();
}

// ─── State ──────────────────────────────────────────────────────────────

const state = {
  offsetDays:  0,
  offsetHours: 0,
  viewYaw:     0,
  viewTilt:    0,
  drag:        null,
  fast:        false,
  lastFastT:   null,
};

// ─── DOM ────────────────────────────────────────────────────────────────

const mainCv = document.getElementById("main");
const mainCx = mainCv.getContext("2d");
const emCv   = document.getElementById("em");
const emCx   = emCv.getContext("2d");
const W = mainCv.width,  H = mainCv.height;
const EW = emCv.width,   EH = emCv.height;
const CX = W / 2, CY = H / 2;

const daysSlider  = document.getElementById("days");
const hoursSlider = document.getElementById("hours");
const daysVal     = document.getElementById("days-val");
const hoursVal    = document.getElementById("hours-val");
const timeText    = document.getElementById("time-text");
const offsetText  = document.getElementById("offset-text");
const fastBtn     = document.getElementById("fast");

daysSlider.addEventListener("input",  e => state.offsetDays  = parseFloat(e.target.value));
hoursSlider.addEventListener("input", e => state.offsetHours = parseFloat(e.target.value));

document.getElementById("reset-time").addEventListener("click", () => {
  state.offsetDays = 0; state.offsetHours = 0;
  daysSlider.value = 0; hoursSlider.value = 0;
});
document.getElementById("reset-view").addEventListener("click", () => {
  state.viewYaw = 0; state.viewTilt = 0;
});
fastBtn.addEventListener("click", () => {
  state.fast = !state.fast;
  fastBtn.classList.toggle("on", state.fast);
  state.lastFastT = state.fast ? performance.now() : null;
});

// ─── Mouse / touch drag for 3D view rotation ────────────────────────────

function dragStart(x, y) {
  state.drag = { x, y, yaw: state.viewYaw, tilt: state.viewTilt };
}
function dragMove(x, y) {
  if (!state.drag) return;
  const SENS = 0.008;
  state.viewYaw  = ((state.drag.yaw + (x - state.drag.x) * SENS) % TAU + TAU) % TAU;
  state.viewTilt = Math.max(0, Math.min(88 * DEG,
                            state.drag.tilt + (y - state.drag.y) * SENS));
}
function dragEnd() { state.drag = null; }

// Use clientX/Y minus the canvas rect, NOT offsetX (which behaves
// differently under transform: scale across browsers). Drag deltas
// stay in CSS pixels — same physical mouse movement → same rotation
// amount, regardless of the layout scale factor.
function canvasPos(e, touch) {
  const src = touch || e;
  const r = mainCv.getBoundingClientRect();
  return { x: src.clientX - r.left, y: src.clientY - r.top };
}

mainCv.addEventListener("mousedown", e => {
  const p = canvasPos(e); dragStart(p.x, p.y);
});
window.addEventListener("mousemove", e => {
  if (!state.drag) return;
  const p = canvasPos(e); dragMove(p.x, p.y);
});
window.addEventListener("mouseup", dragEnd);

mainCv.addEventListener("touchstart", e => {
  if (e.touches.length === 1) {
    const p = canvasPos(e, e.touches[0]); dragStart(p.x, p.y);
    e.preventDefault();
  }
}, { passive: false });
mainCv.addEventListener("touchmove", e => {
  if (e.touches.length === 1 && state.drag) {
    const p = canvasPos(e, e.touches[0]); dragMove(p.x, p.y);
    e.preventDefault();
  }
}, { passive: false });
mainCv.addEventListener("touchend", dragEnd);

// ─── Responsive scaling ──────────────────────────────────────────────────
// The layout is fixed at 1104x934 logical pixels. Compute the largest
// uniform CSS scale that fits the viewport and apply it as a transform
// to .layout. Run on load and on every resize.
const LAYOUT_W = 1104;
const LAYOUT_H = 934;
const layoutEl = document.querySelector(".layout");

function fitLayout() {
  const scale = Math.min(window.innerWidth / LAYOUT_W,
                         window.innerHeight / LAYOUT_H);
  layoutEl.style.transform = `scale(${scale})`;
}
window.addEventListener("resize", fitLayout);
fitLayout();

// ─── Time helpers (mirror Python _effective_now / _days) ────────────────

function effectiveNow() {
  const offsetMs = (state.offsetDays + state.offsetHours / 24) * 86400 * 1000;
  return new Date(Date.now() + offsetMs);
}
function daysSinceJ2000(now) {
  return (now.getTime() - J2000_MS) / 86400000;
}

function planetAngle(name, d) {
  return ((MEAN_LONGITUDES[name] + 360 / ORBITAL_PERIODS[name] * d) % 360) * DEG;
}
function moonGeoLong(d) {
  return ((218.316 + 360 / 27.3 * d) % 360 + 360) % 360;
}
function moonState(d) {
  const moonLong  = moonGeoLong(d);
  const earthLong = ((MEAN_LONGITUDES.Earth + 360 / ORBITAL_PERIODS.Earth * d) % 360 + 360) % 360;
  const sunLong   = (earthLong + 180) % 360;
  const elong     = ((moonLong - sunLong) % 360 + 360) % 360;
  return { elong, phase: elong / 360 };
}
function phaseName(phase) {
  for (const [t, n] of [
    [0.0625, "New Moon"],      [0.1875, "Waxing Crescent"],
    [0.3125, "First Quarter"], [0.4375, "Waxing Gibbous"],
    [0.5625, "Full Moon"],     [0.6875, "Waning Gibbous"],
    [0.8125, "Last Quarter"],  [0.9375, "Waning Crescent"],
  ]) if (phase < t) return n;
  return "New Moon";
}

// ─── 3D projection ──────────────────────────────────────────────────────

function project(x, y, z = 0) {
  const cy = Math.cos(state.viewYaw),  sy = Math.sin(state.viewYaw);
  const ct = Math.cos(state.viewTilt), st = Math.sin(state.viewTilt);
  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  const y2 = y1 * ct - z * st;
  const depth = y1 * st + z * ct;
  return { sx: CX + x1, sy: CY - y2, depth };
}

// ─── Starfields (generated once with a fixed seed) ──────────────────────

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}
function makeStars(w, h, count, rng) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.floor(rng() * w),
      y: Math.floor(rng() * h),
      sz: rng() < 0.7 ? 1 : 2,
      br: 80 + Math.floor(rng() * 140),
    });
  }
  return stars;
}
const rng       = seededRandom(42);
const stars     = makeStars(W,  H,  280, rng);
const emStars   = makeStars(EW, EH, 80,  rng);

// ─── Main solar-system canvas ───────────────────────────────────────────

function drawMain(now) {
  const ctx = mainCx;
  ctx.clearRect(0, 0, W, H);

  // Starfield
  for (const s of stars) {
    const v = s.br.toString(16).padStart(2, "0");
    ctx.fillStyle = "#" + v + v + v;
    ctx.fillRect(s.x, s.y, s.sz, s.sz);
  }

  // Header
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 14px Helvetica, Arial, sans-serif";
  ctx.fillText("SOLAR SYSTEM", CX, 24);

  const total = state.offsetDays + state.offsetHours / 24;
  ctx.font = "bold 11px 'Courier New', monospace";
  if (Math.abs(total) >= 0.01) {
    ctx.fillStyle = "#ffaa44";
    ctx.fillText("[ TIME OFFSET ACTIVE ]", CX, 42);
  } else {
    ctx.fillStyle = "#66dd66";
    ctx.fillText("[ LIVE ]", CX, 42);
  }

  // Orbit ellipses (semi-axes R and R*|cos(tilt)|)
  const v = Math.abs(Math.cos(state.viewTilt));
  for (const [name, [R, , col]] of Object.entries(PLANET_DISPLAY)) {
    ctx.strokeStyle = dim(col, 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(CX, CY, R, Math.max(1, R * v), 0, 0, TAU);
    ctx.stroke();
  }

  // Sun (always at projected origin)
  for (const [s, c] of [[45, "#100800"], [34, "#301400"], [26, "#805000"], [20, "#ffee00"]]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(CX, CY, s, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#ffee88";
  ctx.font = "8px Arial";
  ctx.fillText("Sun", CX, CY + 30);

  // Planets sorted back-to-front
  const d = daysSinceJ2000(now);
  const planets = [];
  for (const [name, [R, sz, col]] of Object.entries(PLANET_DISPLAY)) {
    const a = planetAngle(name, d);
    const p = project(R * Math.cos(a), R * Math.sin(a));
    planets.push({ ...p, name, sz, col, R });
  }
  planets.sort((a, b) => b.depth - a.depth);

  let earthScreen = null;
  for (const p of planets) {
    if (p.name === "Earth") {
      earthScreen = p;
      drawEarthDot(ctx, p.sx, p.sy, p.sz, now);
    } else if (p.name === "Saturn") {
      const rx = p.sz * 2.4, ry = Math.max(1, p.sz * 2.4 * v);
      ctx.strokeStyle = "#b8a060";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.sz, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.sz, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#9999bb";
    ctx.font = "7px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.name, p.sx, p.sy + p.sz + 10);
  }

  if (earthScreen) drawMoonDot(ctx, d, v);

  // View hint (bottom-left)
  ctx.fillStyle = "#557799";
  ctx.font = "9px 'Courier New', monospace";
  ctx.textAlign = "left";
  const tilt = Math.round(state.viewTilt / DEG);
  const yaw  = Math.round((state.viewYaw / DEG) % 360);
  ctx.fillText(
    `drag to rotate  ·  tilt ${String(tilt).padStart(3)}°   yaw ${String(yaw).padStart(3)}°`,
    14, H - 14,
  );
}

function drawEarthDot(ctx, x, y, sz, now) {
  const rot = (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24 * 360;
  ctx.fillStyle = "#0a2a70";
  ctx.strokeStyle = "#4fa3e0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, sz, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2d8a4e";
  for (const off of [0, 135, 250]) {
    tkPieSlice(ctx, x, y, sz, rot + off, 70);
    ctx.fill();
  }
}

function drawMoonDot(ctx, d, v) {
  const earthR = PLANET_DISPLAY.Earth[0];
  const ea = planetAngle("Earth", d);
  const exH = earthR * Math.cos(ea), eyH = earthR * Math.sin(ea);
  const mr = 18;
  const ma = moonGeoLong(d) * DEG;
  const mxH = exH + mr * Math.cos(ma), myH = eyH + mr * Math.sin(ma);
  const e = project(exH, eyH);
  const m = project(mxH, myH);

  // Moon's display orbit ring around Earth
  ctx.strokeStyle = "#1a2233";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.ellipse(e.sx, e.sy, mr, Math.max(1, mr * v), 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#bbbbbb";
  ctx.beginPath();
  ctx.arc(m.sx, m.sy, 2, 0, TAU);
  ctx.fill();
}

// ─── Earth / Moon detail panel (2D polar projection) ────────────────────

function drawEM(now) {
  const ctx = emCx;
  ctx.clearRect(0, 0, EW, EH);

  // Stars
  for (const s of emStars) {
    const v = s.br.toString(16).padStart(2, "0");
    ctx.fillStyle = "#" + v + v + v;
    ctx.fillRect(s.x, s.y, s.sz, s.sz);
  }

  const cx = EW / 2;
  const cy = EH / 2 + 30;

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 12px Helvetica, Arial, sans-serif";
  ctx.fillText("EARTH — MOON SYSTEM", cx, 22);
  ctx.fillStyle = "#7090b0";
  ctx.font = "italic 9px Arial";
  ctx.fillText("(view from above the North pole)", cx, 38);

  const rotDeg = (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24 * 360;

  ctx.fillStyle = "#88aacc";
  ctx.font = "9px 'Courier New', monospace";
  ctx.fillText(`Earth rotation:  ${rotDeg.toFixed(1)}°`, cx, 58);

  // Moon orbit ring
  const moonOrbitR = 78;
  ctx.strokeStyle = "#1a2244";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, moonOrbitR, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  // Earth body
  const er = 40;
  ctx.fillStyle = "#0a2a70";
  ctx.strokeStyle = "#4fa3e0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, er, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Landmasses (rotate with Earth)
  ctx.fillStyle = "#2d8a4e";
  for (const [off, ext] of [[15, 55], [90, 30], [155, 60], [245, 35]]) {
    tkPieSlice(ctx, cx, cy, er, rotDeg + off, ext);
    ctx.fill();
  }

  // North polar ice cap (centre, fixed)
  const capR = Math.floor(er * 0.22);
  ctx.fillStyle = "#e8f0ff";
  ctx.strokeStyle = "#bcd4ea";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, capR, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Day/night terminator: Sun is to the right, so the LEFT half is dark.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, er, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "rgba(0, 0, 51, 0.5)";
  ctx.fillRect(cx - er, cy - er, er, er * 2);
  ctx.restore();

  // Atmosphere halo
  ctx.strokeStyle = "#2255aa";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, er + 6, 0, TAU);
  ctx.stroke();

  // Sun marker (fixed, beyond the Moon's orbit)
  const sx = cx + moonOrbitR + 22, sy = cy;
  ctx.fillStyle = "#ffee00";
  ctx.strokeStyle = "#ffaa00";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#ffee00";
  for (let a = 0; a < 360; a += 45) {
    const ar = a * DEG;
    ctx.beginPath();
    ctx.moveTo(sx + 8  * Math.cos(ar), sy + 8  * Math.sin(ar));
    ctx.lineTo(sx + 12 * Math.cos(ar), sy + 12 * Math.sin(ar));
    ctx.stroke();
  }
  ctx.fillStyle = "#ffee88";
  ctx.font = "7px Arial";
  ctx.fillText("Sun", sx, sy + 26);

  // CCW rotation arrow over the top of Earth
  ctx.strokeStyle = "#ffff44";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const arcR = er + 13;
  for (let i = 0; i <= 16; i++) {
    const a = (35 + (110 - 35) * i / 16) * DEG;
    const x = cx + arcR * Math.cos(a), y = cy - arcR * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Arrow head
  const aE = 110 * DEG, aB = 105 * DEG;
  const xE = cx + arcR * Math.cos(aE), yE = cy - arcR * Math.sin(aE);
  const xB = cx + arcR * Math.cos(aB), yB = cy - arcR * Math.sin(aB);
  const dx = xE - xB, dy = yE - yB, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  ctx.fillStyle = "#ffff44";
  ctx.beginPath();
  ctx.moveTo(xE, yE);
  ctx.lineTo(xE - ux * 8 - uy * 4, yE - uy * 8 + ux * 4);
  ctx.lineTo(xE - ux * 8 + uy * 4, yE - uy * 8 - ux * 4);
  ctx.closePath();
  ctx.fill();

  // Moon — position by elongation, lit half always faces the Sun (right)
  const d = daysSinceJ2000(now);
  const { elong, phase } = moonState(d);
  const ma = elong * DEG;
  const mx = cx + moonOrbitR * Math.cos(ma);
  const my = cy - moonOrbitR * Math.sin(ma);
  const mr = 12;

  ctx.fillStyle = "#cccccc";
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Always shade the LEFT half (away from Sun)
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "rgba(0, 0, 32, 0.5)";
  ctx.fillRect(mx - mr, my - mr, mr, mr * 2);
  ctx.restore();

  // Decorative craters
  ctx.fillStyle = "#aaaaaa";
  ctx.beginPath();
  ctx.arc(mx - 2, my - 1, 1.5, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx + 2, my + 3, 1.5, 0, TAU);
  ctx.fill();

  // Info block
  const yInfo = cy + moonOrbitR + 32;
  ctx.fillStyle = "#aaaacc";
  ctx.font = "9px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText(`Elongation:     ${elong.toFixed(1)}°`,        cx, yInfo);
  ctx.fillText(`Lunar phase:    ${(phase * 100).toFixed(1)}%`, cx, yInfo + 20);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px Helvetica, Arial, sans-serif";
  ctx.fillText(phaseName(phase), cx, yInfo + 40);
  ctx.fillStyle = "#aaaacc";
  ctx.font = "9px 'Courier New', monospace";
  const illum = (1 - Math.cos(elong * DEG)) / 2;
  ctx.fillText(`Illumination:   ${(illum * 100).toFixed(1)}%`, cx, yInfo + 60);

  // Legend
  ctx.fillStyle = "#556677";
  ctx.font = "8px Arial";
  ctx.fillText("Centre = North pole · Rim = Equator",            cx, EH - 50);
  ctx.fillText("Curved arrow = rotation (CCW from above)",       cx, EH - 34);
  ctx.fillText("Dark half = night side · Sun marker = Sun",      cx, EH - 18);
}

// ─── Control panel updates ──────────────────────────────────────────────

function updateControls(now) {
  const d = state.offsetDays, h = state.offsetHours;
  const total = d + h / 24;

  const pad = n => n.toString().padStart(2, "0");
  timeText.textContent =
    `Effective time (UTC):  ${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}  ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

  if (Math.abs(total) < 0.01) {
    offsetText.textContent = "live — no time offset applied";
  } else {
    const sign = total >= 0 ? "+" : "";
    const yrs  = total / 365.25;
    offsetText.textContent =
      `Offset: ${sign}${total.toFixed(1)} days  (${sign}${yrs.toFixed(2)} years) from now`;
  }

  daysVal.textContent  = `${d >= 0 ? "+" : ""}${Math.round(d)} d`;
  hoursVal.textContent = `${h >= 0 ? "+" : ""}${h.toFixed(2)} h`;
}

// ─── Animation loop ─────────────────────────────────────────────────────

function tick() {
  if (state.fast) {
    const t = performance.now();
    if (state.lastFastT !== null) {
      const elapsed = (t - state.lastFastT) / 1000;
      state.offsetDays += elapsed * 100 / 86400;
      // Keep slider thumb in sync (clamped to slider range visually)
      daysSlider.value = Math.max(-1825, Math.min(1825, state.offsetDays));
    }
    state.lastFastT = t;
  }

  const now = effectiveNow();
  updateControls(now);
  drawMain(now);
  drawEM(now);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
