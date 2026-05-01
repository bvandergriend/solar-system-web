// =====================================================================
// Astronomical data — planetary system, moons, Halley's Comet
//
// All planet orbital elements are J2000.0 (Standish 1992 / JPL),
// referenced to the mean ecliptic of J2000. We solve Kepler's equation
// from these and propagate forward — we ignore the small secular drift
// of the elements because at the scales people will look at, it's
// imperceptible relative to the rendered pixel size.
//
//   a   semi-major axis        (AU)
//   e   eccentricity           (dimensionless)
//   i   inclination            (degrees, to ecliptic)
//   L   mean longitude at      (degrees)  L = M + ϖ
//   ϖ   longitude of perihelion(degrees)  ϖ = Ω + ω
//   Ω   longitude of asc node  (degrees)
// =====================================================================

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const AU_KM = 149597870.7;
const C_KMS = 299792.458;        // speed of light km/s
const G_EARTH_GRAV = 9.81;       // m/s² for "weight on …" calc
const SECONDS_PER_DAY = 86400;
const DAYS_PER_YEAR = 365.25;

// ── Easter egg: the Roswell Visitor 🛸 ──────────────────────────────────
// Spawns when the simulation date is inside this window. The Roswell
// Daily Record headline ran on July 8, 1947: "RAAF Captures Flying
// Saucer On Ranch in Roswell Region". The saucer sticks around for
// roughly six simulated months, then quietly disappears.
const ROSWELL_START_MS = Date.UTC(1947, 6,  8);   // July is month 6 (0-indexed)
const ROSWELL_END_MS   = Date.UTC(1948, 0,  1);

const VISITOR = {
  id: "Visitor", color: "#cdd8e8", radius: 4,
  facts: {
    type: "Unidentified aerial phenomenon",
    diameter: 0.007,        // ~7 m, displayed specially
    moons: 0,
    crew: "5 little green men (rumoured)",
    fact: "On July 8, 1947 the Roswell Daily Record reported that the Roswell Army Air Field had captured a 'flying disc'. Within 24 hours the official explanation was revised to 'weather balloon'. Take that as you will.",
  },
};

// ── The Sun (at the origin — no orbit) ─────────────────────────────────
const SUN = {
  id: "Sun", color: "#ffeebb", radius: 10,
  facts: {
    type: "G-type main-sequence star",
    mass: 333000, diameter: 1391000, day: 25.4,
    gravity: 274, tempC: 5505, moons: 0,
    fact: "The Sun is 99.86% of all the mass in the solar system. Its core fuses 600 million tonnes of hydrogen into helium every second; the energy released takes about 100,000 years to reach the surface and another 8 minutes to reach Earth.",
  },
};

// ── Planets ────────────────────────────────────────────────────────────
const PLANETS = [
  { id: "Mercury", color: "#a39787", radius: 4,
    elements: { a: 0.38709927, e: 0.20563593, i:  7.00497902,
                L: 252.25032350, lp:  77.45779628, on: 48.33076593 },
    facts: { type: "Terrestrial planet",
             mass: 0.0553, diameter: 4879, day: 175.94, year: 87.97,
             gravity: 3.7, tempC: 167, moons: 0, magnitude: 0,
             fact: "Mercury's day (sunrise to sunrise) is twice as long as its year — 176 Earth days vs. 88." } },

  { id: "Venus", color: "#e8cda0", radius: 7,
    elements: { a: 0.72333566, e: 0.00677672, i:  3.39467605,
                L:181.97909950, lp:131.60246718, on: 76.67984255 },
    facts: { type: "Terrestrial planet",
             mass: 0.815, diameter: 12104, day: 116.75, year: 224.70,
             gravity: 8.87, tempC: 464, moons: 0, magnitude: -4.4,
             fact: "Venus rotates backwards relative to its orbit, and so slowly that its day (243 Earth days) is longer than its year (225)." } },

  { id: "Earth", color: "#4fa3e0", radius: 8,
    elements: { a: 1.00000261, e: 0.01671123, i: -0.00001531,
                L:100.46457166, lp:102.93768193, on:  0.0 },
    facts: { type: "Terrestrial planet — your home",
             mass: 1, diameter: 12742, day: 1.0, year: 365.25,
             gravity: 9.81, tempC: 15, moons: 1, magnitude: null,
             fact: "Earth is the only place we've ever found life. Its tilted axis (23.5°) is what gives us seasons." } },

  { id: "Mars", color: "#c1440e", radius: 5,
    elements: { a: 1.52371034, e: 0.09339410, i:  1.84969142,
                L: -4.55343205, lp:-23.94362959, on: 49.55953891 },
    facts: { type: "Terrestrial planet",
             mass: 0.107, diameter: 6779, day: 1.026, year: 686.97,
             gravity: 3.71, tempC: -65, moons: 2, magnitude: -2.9,
             fact: "Mars hosts Olympus Mons, the largest known volcano in the solar system — three times taller than Mt. Everest." } },

  { id: "Jupiter", color: "#c88b3a", radius: 16,
    elements: { a: 5.20288700, e: 0.04838624, i:  1.30439695,
                L: 34.39644051, lp: 14.72847983, on:100.47390909 },
    facts: { type: "Gas giant",
             mass: 317.8, diameter: 139820, day: 0.41, year: 4332.59,
             gravity: 24.79, tempC: -110, moons: 95, magnitude: -2.94,
             fact: "Jupiter has 95 known moons. Its Great Red Spot is a storm so big Earth could fit inside it — and it has been raging for at least 350 years." } },

  { id: "Saturn", color: "#e4d191", radius: 14,
    elements: { a: 9.53667594, e: 0.05386179, i:  2.48599187,
                L: 49.95424423, lp: 92.59887831, on:113.66242448 },
    facts: { type: "Gas giant",
             mass: 95.16, diameter: 116460, day: 0.45, year: 10759.22,
             gravity: 10.44, tempC: -140, moons: 146, magnitude: 0.43,
             fact: "Saturn's rings are mostly water ice. They're huge but only ~10 metres thick — proportionally thinner than a sheet of paper laid across a football field." } },

  { id: "Uranus", color: "#7de8e8", radius: 11,
    elements: { a:19.18916464, e: 0.04725744, i:  0.77263783,
                L:313.23810451, lp:170.95427630, on: 74.01692503 },
    facts: { type: "Ice giant",
             mass: 14.54, diameter: 50724, day: 0.72, year: 30688.50,
             gravity: 8.87, tempC: -195, moons: 27, magnitude: 5.68,
             fact: "Uranus rotates on its side — its axis is tilted 98° from its orbital plane, so its poles take turns facing the Sun for 42 years at a stretch." } },

  { id: "Neptune", color: "#4b70dd", radius: 10,
    elements: { a:30.06992276, e: 0.00859048, i:  1.77004347,
                L:-55.12002969, lp: 44.96476227, on:131.78422574 },
    facts: { type: "Ice giant",
             mass: 17.15, diameter: 49244, day: 0.67, year: 60182.0,
             gravity: 11.15, tempC: -200, moons: 14, magnitude: 7.78,
             fact: "Neptune has the fastest winds in the solar system — over 2,000 km/h, faster than the speed of sound on Earth." } },
];

// ── Dwarf planets ──────────────────────────────────────────────────────
const DWARFS = [
  { id: "Pluto", color: "#c8b8a0", radius: 3, isDwarf: true,
    elements: { a: 39.482, e: 0.249, i: 17.16,
                L: 238.93, lp: 224.07, on: 110.30 },
    facts: { type: "Dwarf planet",
             mass: 0.00218, diameter: 2376, day: 6.39, year: 90520,
             gravity: 0.62, tempC: -229, moons: 5, magnitude: 13.65,
             fact: "Pluto's largest moon Charon is so big that the two worlds orbit a point in empty space *between* them — making them a true binary system." } },
];

// Halley's Comet — period 75.32 yr, last perihelion 1986-02-09 18:14 UT.
// Computed mean anomaly at J2000 from time-since-perihelion.
const COMETS = [
  { id: "Halley", color: "#cae0ff", radius: 3, isComet: true,
    elements: {
      a: 17.834, e: 0.967, i: 162.26,
      // M0 (mean anomaly at J2000) ≈ 360° × (J2000 − 1986-02-09) / period
      L: 236.4,        // L = M + ϖ;  ϖ = Ω + ω = 58.42 + 111.33 = 169.75°
      lp: 169.75,
      on: 58.42,
    },
    facts: { type: "Periodic comet",
             period: "75.32 years",
             mass: null, diameter: 11, day: null, year: 27510,
             gravity: null, tempC: null, moons: 0, magnitude: null,
             fact: "Halley's Comet is the only short-period comet visible to the naked eye from Earth, returning roughly every 76 years. Its next perihelion is July 28, 2061." } },
];

// ── Moons (orbit their parent, not the Sun) ────────────────────────────
// orbitR_km: orbit radius around parent (km, treated as circular for the
// purpose of this visualisation — eccentricities are all <0.05 anyway)
// period_d : sidereal period (Earth days)
// epoch_M  : approximate mean anomaly at J2000 (degrees) — only used so
//            the moons aren't all clustered at the same starting angle.
// Moons. Display radius is roughly proportional to real diameter so the
// Galilean moons clearly look bigger than tiny inner moons like
// Amalthea, and Triton dwarfs Proteus etc. orbitR_km is treated as a
// circular orbit around the parent (real moons have small eccentricities
// that don't matter at our scales). epoch_M just spreads the moons
// around their orbits at J2000 so they don't all line up on a radius.
const MOONS = {
  Earth: [
    { id: "Moon", color: "#cccccc", radius: 4, orbitR_km: 384400, period_d: 27.32, epoch_M: 218.3,
      facts: { type: "Natural satellite", mass: 0.0123, diameter: 3475, day: 27.32,
               gravity: 1.62, tempC: -23, moons: 0, magnitude: -12.74,
               fact: "The Moon is slowly drifting away from Earth at about 3.8 cm per year. In a billion years, total solar eclipses won't be possible." } },
  ],
  Mars: [
    { id: "Phobos", color: "#a09080", radius: 2, orbitR_km:  9376, period_d: 0.319, epoch_M: 80,
      facts: { type: "Moon of Mars", diameter: 22, day: 0.319, gravity: 0.0057, moons: 0,
               fact: "Phobos orbits Mars faster than Mars rotates — it rises in the west and sets in the east, twice a Martian day." } },
    { id: "Deimos", color: "#a09080", radius: 2, orbitR_km: 23463, period_d: 1.262, epoch_M: 200,
      facts: { type: "Moon of Mars", diameter: 12, day: 1.262, gravity: 0.003, moons: 0,
               fact: "Deimos is so small that on its surface you could throw a ball faster than its escape velocity — and watch it fly into space." } },
  ],
  Jupiter: [
    { id: "Amalthea", color: "#9d6045", radius: 2, orbitR_km:  181365, period_d:  0.498, epoch_M:  60,
      facts: { type: "Inner moon of Jupiter", diameter: 167, day: 0.498, gravity: 0.02, moons: 0,
               fact: "Amalthea orbits Jupiter just outside the rings; its red colour comes from sulfur dust kicked up off Io." } },
    { id: "Io",       color: "#e8d480", radius: 4, orbitR_km:  421700, period_d:  1.769, epoch_M:  20,
      facts: { type: "Galilean moon", diameter: 3643, day: 1.769, gravity: 1.796, moons: 0,
               fact: "Io is the most volcanically active body in the solar system — over 400 active volcanoes, fueled by tidal flexing from Jupiter's gravity." } },
    { id: "Europa",   color: "#d8c8a8", radius: 4, orbitR_km:  671034, period_d:  3.551, epoch_M: 110,
      facts: { type: "Galilean moon", diameter: 3122, day: 3.551, gravity: 1.314, moons: 0,
               fact: "Beneath Europa's icy crust lies a saltwater ocean with more water than all of Earth's oceans combined." } },
    { id: "Ganymede", color: "#aab0b0", radius: 5, orbitR_km: 1070412, period_d:  7.155, epoch_M: 240,
      facts: { type: "Galilean moon", diameter: 5268, day: 7.155, gravity: 1.428, moons: 0,
               fact: "Ganymede is the largest moon in the solar system — bigger than Mercury — and the only moon with its own magnetic field." } },
    { id: "Callisto", color: "#7a7060", radius: 5, orbitR_km: 1882709, period_d: 16.689, epoch_M:  60,
      facts: { type: "Galilean moon", diameter: 4821, day: 16.689, gravity: 1.235, moons: 0,
               fact: "Callisto's surface is the most heavily cratered in the solar system — every patch shows scars billions of years old." } },
  ],
  Saturn: [
    { id: "Mimas",     color: "#c8c8c8", radius: 2, orbitR_km:  185539, period_d:  0.942, epoch_M:  10,
      facts: { type: "Moon of Saturn", diameter: 396, day: 0.942, gravity: 0.064, moons: 0,
               fact: "Mimas's enormous Herschel crater makes it look uncannily like the Death Star from Star Wars." } },
    { id: "Enceladus", color: "#e0e8f0", radius: 2, orbitR_km:  238037, period_d:  1.370, epoch_M:  30,
      facts: { type: "Moon of Saturn", diameter: 504, day: 1.370, gravity: 0.113, moons: 0,
               fact: "Enceladus shoots geysers of water ice from its south pole, ejecting material that forms one of Saturn's rings." } },
    { id: "Tethys",    color: "#cdc8c0", radius: 3, orbitR_km:  294672, period_d:  1.888, epoch_M:  70,
      facts: { type: "Moon of Saturn", diameter: 1062, day: 1.888, gravity: 0.146, moons: 0,
               fact: "Tethys is mostly water ice. Its huge Ithaca Chasma canyon stretches three quarters of the way around the moon." } },
    { id: "Dione",     color: "#c0b8a8", radius: 3, orbitR_km:  377396, period_d:  2.737, epoch_M: 130,
      facts: { type: "Moon of Saturn", diameter: 1123, day: 2.737, gravity: 0.232, moons: 0,
               fact: "Dione's leading hemisphere is uniformly bright; its trailing side is crossed by 'wispy' canyons hundreds of metres deep." } },
    { id: "Rhea",      color: "#b0a890", radius: 3, orbitR_km:  527108, period_d:  4.518, epoch_M: 200,
      facts: { type: "Moon of Saturn", diameter: 1527, day: 4.518, gravity: 0.264, moons: 0,
               fact: "Rhea is Saturn's second-largest moon and one of the few in the solar system that may have its own faint ring system." } },
    { id: "Titan",     color: "#c89c5e", radius: 5, orbitR_km: 1221870, period_d: 15.945, epoch_M: 150,
      facts: { type: "Moon of Saturn", mass: 0.0225, diameter: 5150, day: 15.945, gravity: 1.352, moons: 0,
               fact: "Titan has lakes and rivers — full of liquid methane, not water. It's the only moon with a thick atmosphere." } },
    { id: "Iapetus",   color: "#806858", radius: 3, orbitR_km: 3560820, period_d: 79.32,  epoch_M: 270,
      facts: { type: "Moon of Saturn", diameter: 1469, day: 79.32, gravity: 0.223, moons: 0,
               fact: "Iapetus has a striking two-toned surface — one hemisphere is bright as snow, the other dark as soot." } },
  ],
  Uranus: [
    { id: "Miranda",  color: "#a8a890", radius: 2, orbitR_km: 129390, period_d:  1.413, epoch_M:  40,
      facts: { type: "Moon of Uranus", diameter: 472,  day: 1.413, gravity: 0.079, moons: 0,
               fact: "Miranda's chaotic surface — terraced cliffs up to 20 km tall — looks like it was shattered and reassembled." } },
    { id: "Ariel",    color: "#b8b0a0", radius: 3, orbitR_km: 191020, period_d:  2.520, epoch_M:  90,
      facts: { type: "Moon of Uranus", diameter: 1158, day: 2.520, gravity: 0.269, moons: 0,
               fact: "Ariel is the brightest moon of Uranus, with rift valleys that suggest a once-active interior." } },
    { id: "Umbriel",  color: "#605850", radius: 3, orbitR_km: 266000, period_d:  4.144, epoch_M: 160,
      facts: { type: "Moon of Uranus", diameter: 1170, day: 4.144, gravity: 0.231, moons: 0,
               fact: "Umbriel is the darkest of the major Uranian moons — almost as black as charcoal." } },
    { id: "Titania",  color: "#a09888", radius: 3, orbitR_km: 435910, period_d:  8.706, epoch_M: 220,
      facts: { type: "Moon of Uranus", diameter: 1577, day: 8.706, gravity: 0.367, moons: 0,
               fact: "Titania is Uranus's largest moon. Its Messina Chasmata canyon is over 1,500 km long." } },
    { id: "Oberon",   color: "#988878", radius: 3, orbitR_km: 583520, period_d: 13.463, epoch_M: 290,
      facts: { type: "Moon of Uranus", diameter: 1523, day: 13.463, gravity: 0.346, moons: 0,
               fact: "Oberon, the outermost large moon of Uranus, is the only one whose surface shows clear evidence of impact-melt deposits." } },
  ],
  Neptune: [
    { id: "Proteus",  color: "#787878", radius: 2, orbitR_km:  117647, period_d:   1.122, epoch_M:  50,
      facts: { type: "Moon of Neptune", diameter: 420, day: 1.122, gravity: 0.07, moons: 0,
               fact: "Proteus is one of the darkest objects in the solar system — barely lit by a Sun 30 times fainter than from Earth." } },
    { id: "Triton",   color: "#d0c8c0", radius: 4, orbitR_km:  354759, period_d:   5.877, epoch_M: 180,
      facts: { type: "Moon of Neptune", diameter: 2706, day: 5.877, gravity: 0.779, moons: 0,
               fact: "Triton orbits Neptune backwards — strong evidence it was a Kuiper Belt object captured by Neptune's gravity." } },
    { id: "Nereid",   color: "#888888", radius: 2, orbitR_km: 5513818, period_d: 360.13,  epoch_M:  90,
      facts: { type: "Moon of Neptune", diameter: 340, day: 360.13, gravity: 0.07, moons: 0,
               fact: "Nereid has the most eccentric orbit of any known moon — it swings from 1.4 to 9.7 million km from Neptune." } },
  ],
  Pluto: [
    { id: "Charon", color: "#a09890", radius: 3, orbitR_km: 19571, period_d: 6.387, epoch_M: 100,
      facts: { type: "Moon of Pluto", diameter: 1212, day: 6.387, gravity: 0.288, moons: 0,
               fact: "Charon is so big relative to Pluto that the two worlds orbit a point in space between them — making them a true binary." } },
  ],
};

// ── Procedural belts ───────────────────────────────────────────────────
function makeAsteroidBelt(seed = 7, count = 350) {
  const out = [];
  let s = seed >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
  for (let i = 0; i < count; i++) {
    const a = 2.2 + rng() * 1.0;       // 2.2–3.2 AU
    const e = rng() * 0.18;
    const inc = (rng() - 0.5) * 14;    // ±7°
    const L  = rng() * 360;
    const lp = rng() * 360;
    const on = rng() * 360;
    out.push({ a, e, i: inc, L, lp, on });
  }
  return out;
}
function makeKuiperBelt(seed = 19, count = 380) {
  const out = [];
  let s = seed >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
  for (let i = 0; i < count; i++) {
    const a = 35 + rng() * 15;         // 35–50 AU
    const e = rng() * 0.2;
    const inc = (rng() - 0.5) * 30;    // ±15°
    const L = rng() * 360;
    const lp = rng() * 360;
    const on = rng() * 360;
    out.push({ a, e, i: inc, L, lp, on });
  }
  return out;
}

// ── Zodiac (12 ecliptic longitude regions, used for the constellation
//    overlay on the celestial sphere). Coordinates are ecliptic
//    longitude of each sign's centre, plus a pictogram of "stars"
//    relative to that centre. Drawn far out at a fixed sphere radius.
const ZODIAC = [
  { name: "Aries",       sym: "♈", lon:  18, stars: [[-3,-1],[0,0],[3,1]] },
  { name: "Taurus",      sym: "♉", lon:  48, stars: [[-4,2],[-2,0],[0,-1],[3,1],[5,3]] },
  { name: "Gemini",      sym: "♊", lon:  78, stars: [[-2,-3],[-2,3],[2,-3],[2,3]] },
  { name: "Cancer",      sym: "♋", lon: 108, stars: [[-3,0],[0,1],[3,-1]] },
  { name: "Leo",         sym: "♌", lon: 138, stars: [[-4,-1],[-2,2],[0,0],[3,1],[5,-1]] },
  { name: "Virgo",       sym: "♍", lon: 174, stars: [[-4,2],[-1,0],[2,1],[5,-2]] },
  { name: "Libra",       sym: "♎", lon: 207, stars: [[-3,-1],[0,1],[3,-1]] },
  { name: "Scorpius",    sym: "♏", lon: 240, stars: [[-4,2],[-2,0],[0,-2],[2,-1],[4,1]] },
  { name: "Sagittarius", sym: "♐", lon: 268, stars: [[-3,1],[0,-1],[3,2],[5,0]] },
  { name: "Capricorn",   sym: "♑", lon: 300, stars: [[-3,1],[0,-1],[3,1]] },
  { name: "Aquarius",    sym: "♒", lon: 330, stars: [[-4,-1],[-1,1],[2,-1],[4,1]] },
  { name: "Pisces",      sym: "♓", lon: 355, stars: [[-3,1],[-1,-1],[2,0],[4,2]] },
];

// ── Famous events — date strings parsed at lookup time ─────────────────
const EVENTS = [
  { date: "1969-07-20T20:17:00Z", label: "Apollo 11 lunar landing" },
  { date: "1977-09-05T12:56:00Z", label: "Voyager 1 launches toward outer planets" },
  { date: "1979-03-05T00:00:00Z", label: "Voyager 1 reaches Jupiter" },
  { date: "1986-02-09T00:00:00Z", label: "Halley's Comet at perihelion" },
  { date: "1989-08-25T00:00:00Z", label: "Voyager 2 flies past Neptune" },
  { date: "1997-07-04T16:57:00Z", label: "Mars Pathfinder lands" },
  { date: "1997-04-01T00:00:00Z", label: "Comet Hale-Bopp at peak brightness" },
  { date: "2003-08-27T09:51:00Z", label: "Mars closest to Earth in 60,000 years" },
  { date: "2006-01-19T19:00:00Z", label: "New Horizons launches to Pluto" },
  { date: "2012-08-06T05:17:00Z", label: "Curiosity rover lands on Mars" },
  { date: "2014-11-12T16:34:00Z", label: "Philae lander touches comet 67P" },
  { date: "2015-07-14T11:49:00Z", label: "New Horizons flies past Pluto" },
  { date: "2017-08-21T18:25:00Z", label: "Total solar eclipse over USA" },
  { date: "2019-01-01T00:00:00Z", label: "New Horizons flies past Arrokoth" },
  { date: "2020-12-21T18:20:00Z", label: "Great Conjunction (Jupiter–Saturn)" },
  { date: "2024-04-08T18:18:00Z", label: "Total solar eclipse over USA" },
  { date: "2061-07-28T00:00:00Z", label: "Halley's Comet next perihelion (predicted)" },
];

// ── Tour script (a short narrated walk-through) ────────────────────────
const TOUR = [
  { title: "Welcome",
    body: "This is our solar system. Eight planets, a swarm of small worlds, and one star — drawn from real positions calculated for any moment in the past or future.",
    action: { reset: true } },
  { title: "The inner planets",
    body: "Mercury, Venus, Earth, and Mars are rocky worlds close to the Sun. You can see them sweeping around quickly — Mercury orbits the Sun every 88 Earth days.",
    action: { zoom: 90, track: null } },
  { title: "The asteroid belt",
    body: "Beyond Mars sits a ring of millions of rocky bodies — the leftovers of a planet that never formed because Jupiter's gravity kept stirring them up.",
    action: { zoom: 50, toggle: { belts: true } } },
  { title: "Jupiter, king of planets",
    body: "Jupiter is so massive — more than twice all the other planets combined — that the Sun actually orbits a point just outside its own surface to balance Jupiter's pull.",
    action: { track: "Jupiter", zoom: 140 } },
  { title: "Saturn's rings",
    body: "Saturn's rings are mostly water ice and dust. Despite being 280,000 km across, they're typically only 10 metres thick.",
    action: { track: "Saturn", zoom: 110 } },
  { title: "The outer worlds",
    body: "Uranus and Neptune are ice giants — colder, smaller, and made of more 'ices' (water, methane, ammonia) than Jupiter and Saturn's mostly-hydrogen bulk.",
    action: { track: null, zoom: 18 } },
  { title: "Halley's Comet",
    body: "Comets travel on highly elongated orbits. Halley's Comet sweeps in close to the Sun every 75 years and was last visible in 1986. Watch its tail always point away from the Sun.",
    action: { jumpDate: "1986-02-09", track: "Halley", zoom: 30 } },
  { title: "Now you explore",
    body: "Drag to rotate. Scroll to zoom. Click any body to learn more. Use the date picker to jump through time, or the speed slider to fast-forward. Enjoy.",
    action: { reset: true } },
];
