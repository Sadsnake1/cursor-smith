// --- Hot-head: the fire's colour ramp -------------------------------------
// Waypoint positions. The first is a placeholder filled in per-call with the
// cursor's own colour (see hotFireColor), so the coolest fire is the colour of
// the cursor that lit it and everything above that is a warm climb.
// Separate from Speed Demon's heatColor, which has its own ramp for the caret.
// The cursor's own colour is deliberately given only a sliver at the very
// bottom. It used to hold the bottom 28%, which - combined with the fact that
// most particles spend most of their life at a low temperature - meant the bulk
// of the fire was drawn in the cursor's colour rather than in fire colours. With
// the default green cursor the whole effect came out green. It's a waypoint so
// the fire still resolves to the cursor's colour at its coolest edge, but it
// shouldn't be most of what you see.
export const HOT_STOP_POS = [0, 0.12, 0.42, 0.72, 1];

// The fixed hot end, as HSV: a warm blackbody climb, yellow up through
// red-orange to white-hot. No violet/blue - this is deliberately the classic
// "fire" ramp rather than a full-spectrum one, so the whole effect reads as
// something burning rather than as a colour cycle. Value is pinned at 1 so the
// cursor emits light rather than reflecting it; only hue and saturation carry
// the temperature. The white end keeps a faint warm tint instead of being pure
// #ffffff, so the hottest core still looks like flame.
export const HOT_HSV = [
  [ 44, 1.00, 1.00],  // amber-yellow (a touch warmer than a pure 48 gold,
                      // which reads green-ish next to orange)
  [ 30, 1.00, 1.00],  // orange
  [ 12, 0.95, 1.00],  // red-orange
  [ 26, 0.20, 1.00],  // white-hot, faintly warm
];

// Temperature is lifted by this exponent before the ramp is sampled. A particle
// cools linearly with its remaining life, but lifetimes are skewed short, so a
// linear mapping parks most of the fire at the very bottom of the ramp - the
// cursor's own colour - and almost nothing in the oranges. Raising temp to a
// power below 1 pushes the bulk of the distribution up into the fire colours
// while leaving the extremes where they are.
export const HOT_TEMP_GAMMA = 0.55;

// --- Hot-head: pixel fire, after smear-cursor.nvim's particle renderer -----
// (sphamba/smear-cursor.nvim, lua/smear_cursor/draw.lua :: draw_particles)
//
// Upstream's insight, which this keeps: particles are dimensionless POINTS
// binned into a grid, and how big one LOOKS is decided by its age, not by any
// per-particle radius. Fresh particles are drawn as solid blocks, aged ones
// shrink to specks, then they fade. That progression is the whole effect.
//
// Upstream's grid, which this does NOT keep: it bins into character cells
// subdivided 4 rows x 2 cols, and gives all eight sub-cells of a cell one
// shared colour and glyph, because a terminal can only put one character in
// one cell. On a canvas that constraint doesn't exist, and honouring it anyway
// made the grid far too legible - the fire came out as a lattice of
// character-sized rectangles that read as a tiling artefact rather than as
// fire. So the grid here is a fine SQUARE lattice, sized off the font rather
// than off the character cell, and every grid square decides its own size and
// colour from the particles in it. Same big-to-small-to-gone progression, none
// of the character-cell banding.
//
// 2026-09-17: this renderer was replaced twice in one day - by a renderer of
// individual squares, then by upstream's own cell lattice - and brought back
// on the user's instruction, "as it was", with one change asked for by name:
// MORE BLOCK TYPES. Every fresh particle used to be the same 2x2 patch, so
// the mass was a checkerboard of one shape. Upstream's octant glyphs give a
// cell any of 256 shapes, and that variety is what reads as fire rather than
// as tiling. So a particle now carries a SHAPE from the table below, chosen
// at spawn - the longer it will live, the bigger the shape, and the recording's
// 2-wide 4-tall column is the biggest - mirrored at random, and stepping down
// the table as the particle ages, until the pixel and the dot the original
// had. Everything else - the lattice, the rates, the physics, the shading,
// the cell union - is the original.
//
// Size stages, in grid squares:
// 4.5 (from 5.6) and a cap of 5: a 5px square at body size. Chunks are drawn
// in these squares, so the whole fire scales with this number. Settled by
// eye on 2026-09-17: 5.6 (4px) left a speck no size between the full square
// and one pixel less, 3.8 (6px) was too big a fire, 4.5 is where the user
// stopped.
export const HOT_PX_DIVISOR = 4.5;   // font size / this = grid square, in px
export const HOT_PX_MIN = 2;
export const HOT_PX_MAX = 5;
// Below this fraction of its life a particle is a small dot inside one grid
// square whatever its shape; above it, its shape (shrinking with age).
export const HOT_STAGE_PIXEL = 0.22;
// The block shapes, biggest first, as rows of grid squares top to bottom;
// the bottom-left square is the particle's own and the shape grows up and
// right (fire rises), mirrored left-right at random per particle. A particle
// spawns partway down this list by how long it will live - a long-lived one
// at the top, a short-lived one near the single square - and walks the rest
// of the way down as it ages, so every chunk shrinks through several shapes
// before it is a dot. Areas: 8, 6, 5, 5, 6, 4, 3, 3, 3, 2, 2, 1.
export const HOT_BLOCK_SHAPES = [
  ["11", "11", "11", "11"],   // 2x4 column, the recording's chunk
  ["011", "111", "111"],      // 3x3 notched, the widest
  ["110", "111", "111"],
  ["11", "11", "11"],         // 2x3
  ["01", "11", "11"],         // 2x3 notched at the top
  ["10", "11", "11"],
  ["111", "111"],             // 3x2 wide
  ["1", "1", "1", "1"],       // 1x4 thin column
  ["11", "11"],               // 2x2, the original's fresh block
  ["1", "1", "1"],            // 1x3 tall
  ["01", "11"],               // small L
  ["10", "11"],
  ["111"],                    // 3x1
  ["11"],                     // 2x1 wide
  ["1", "1"],                 // 1x2 tall
  ["1"],                      // 1x1, the original's pixel
];
// How the shade stage is read off a shape's area, for the per-stage alpha
// below: the biggest chunks are the most solid.
export const hotShapeStage = (area: number) => (area >= 6 ? 3 : area >= 4 ? 2 : area >= 2 ? 1.5 : 1);
// The palette, kept small on purpose ("less gradients"): a chunk's colour is
// one of HOT_COLOR_LEVELS steps along the ramp, and the ramp is only used up
// to HOT_TEMP_MAX of its length - from the base colour into the first warm
// stops, never on to white-hot. Alpha likewise steps through
// HOT_ALPHA_LEVELS. Three colours, three alphas: pixel art, not a gradient.
export const HOT_COLOR_LEVELS = 3;
export const HOT_TEMP_MAX = 0.5;
export const HOT_ALPHA_LEVELS = 3;
export const hotQuant = (v: number, levels: number) => Math.round(Math.max(0, Math.min(1, v)) * levels) / levels;
// Sparks: the tiny particles. Every chunk spawns this many alongside it -
// short-lived specks that rise faster and higher than the chunks, drawn at
// their own positions off the lattice. They are the haze above the flame.
// Their own budget, so they never starve the chunks.
export const HOT_SPARKS_PER_CHUNK = 1;
export const HOT_SPARK_MAX = 60;
// Both caps are PER CARET. The ember pool is shared by every caret and the
// primary spawns first each frame, so with its fire sitting at the cap a
// secondary could never light at all - which is what "hot-head has no
// multi-cursor effect" was (2026-09-17). Each full-effects caret adds a
// cap's worth, up to this many carets, the way stardust already does.
export const HOT_BUDGET_CARETS = 8;
// A speck - a spark, or a spent chunk's dot - is a square this fraction of a
// grid square, still snapped to the lattice (centred in its square, whole
// pixels). 1.0 was a full square, 0.6 rounded to half of one at body size
// and was "way too small"; 0.85 is where the user stopped. A speck is whole
// pixels: on the 5px square at body size 0.85 rounds to 4px, one under the
// full square; on a 4px square (smaller fonts) to 3px; on 3px to 3px.
export const HOT_SPECK_SCALE = 0.85;
// A third, finer population: half-size specks (HOT_FINE_SCALE of a square),
// dimmer, spawned with a chunk only HOT_FINE_CHANCE of the time so they
// stay a hint - "not too much, so the effect is subtle". They rise like
// sparks and count against the sparks' cap.
export const HOT_FINE_SCALE = 0.5;
export const HOT_FINE_CHANCE = 0.4;
// A jump - a committed caret move of JUMP_TRAIL_MIN_DIST or more, the same
// test the jump trail and the glitch use - flares the fire for
// HOT_ENGULF_MS where the caret lands: extra chunks and sparks on the same
// line as the rest of the fire, the tops of the glyphs, across the caret's
// cell and HOT_ENGULF_PAD_X characters either side. Until 1.6.4 the flare
// filled a box around the caret, below and beside it as well as above -
// fire on the caret and over the letters, "all over the place" (2026-09-24).
// A first cut threw a burst outward from a ring around the drawn caret; it
// never showed, because with Smooth Movement the drawn caret eases across a
// jump and never travels far in one frame.
export const HOT_ENGULF_MS = 260;
export const HOT_ENGULF_RATE = 200;           // particles per second at the landing, at Quantity 1
export const HOT_ENGULF_PAD_X = 1.1;          // how far beside the caret, in character widths
export const HOT_SPARK_LIFT = 1.9;     // times the chunk's buoyancy
export const HOT_SPARK_RISE = 5;       // cw/s of extra upward start
// Discrete shade steps (upstream color_levels). Quantising keeps edges crunchy.
export const FLAME_LEVELS = 16;

// Particle budget and physics. Units marked "cw" are character widths (or
// character widths per second) exactly as upstream expresses them, multiplied
// by the measured character width at spawn - so the fire scales with font size
// instead of being tuned for one zoom level.
// 110, up from 50: the trail behind a moving caret needs its own budget (see
// HOT_TRAIL_* below), or it only ever gets what the head leaves over.
export const FLAME_MAX_NUM = 110;
export const FLAME_MAX_LIFETIME = 620;         // ms, default fade time
// Upstream particle_lifetime_distribution_exponent. lifetime = max * rand^n
// skews toward zero, so most particles are short-lived specks and a minority
// are long-lived blocks. That ratio is what gives the fire a few solid chunks
// in a haze of sparks. It was 3.4 over a floor of a tenth: half the chunks
// lived under 110 ms and stepped through every shape in that time - "too
// fast to discombobulate" (2026-09-24). 2.2 over a quarter holds a chunk
// about half again as long; the emission came down to match (below).
export const FLAME_LIFETIME_EXP = 2.2;
export const HOT_LIFE_FLOOR = 0.25;            // share of the fade time every chunk gets
// How a chunk steps down HOT_BLOCK_SHAPES with its age: gone^this, so it
// keeps its shape for the first part of its life and breaks up after, not
// one step per few frames from birth.
export const HOT_SHAPE_EASE = 1.6;
// A quarter of what the original emitted (1350, 1.4, capped at 260 alive).
// With every particle a different shape the mass has to break into chunks
// to show them, and the original filled its cap and packed 180 particles
// into two characters' width - a wall, and a wall has no shapes. At this
// rate a few dozen are alive: distinct chunks, a column above the caret,
// specks at the top. Quantity scales it back up for anyone who wants the
// wall.
// 190 until 1.6.4; 125 with the longer lives (FLAME_LIFETIME_EXP) keeps about
// as many alive as before.
export const FLAME_PER_SECOND = 125;           // steady emission while burning
export const FLAME_PER_LENGTH = 0.8;           // extra particles per cw of caret travel
export const FLAME_SPREAD = 0.5;               // cw, lateral scatter at the emit point
// The start is a kick UP, within HOT_START_CONE either side of straight up.
// It used to be a full disc plus a fifth of the caret's own velocity, so fire
// was thrown sideways and dragged along a move instead of rising where it
// was lit - "not in a straight line" (2026-09-24).
export const FLAME_INITIAL_VELOCITY = 6;       // cw/s, upstream particle_max_initial_velocity
export const HOT_START_CONE = 0.45;            // radians either side of straight up
export const FLAME_RANDOM_VELOCITY = 62;       // cw/s, per-frame turbulence
// The turbulence per axis. Across it was the full amount, a random walk that
// read as the fire wandering off; up and down it was the full amount too, a
// flutter. Both are small now, and the side-to-side is a sway instead
// (HOT_SWAY_*): a slow wave, not noise.
export const HOT_TURB_X = 0.15;
export const HOT_TURB_Y = 0.5;
// The sway: each particle drifts side to side on a sine of HOT_SWAY_HZ
// (give or take a quarter) with its own phase, its reach growing from none
// at birth to HOT_SWAY_CW characters over HOT_SWAY_GROW_MS, so the fire
// leaves its line straight and waves a little as it climbs.
export const HOT_SWAY_CW = 0.3;
export const HOT_SWAY_HZ = 1.3;
export const HOT_SWAY_GROW_MS = 260;
export const FLAME_DAMPING = 0.2;              // per 17ms, upstream particle_damping
// Upstream's particle_gravity is +20 (downward: it's a smear, debris falls).
// Negated here, because this is fire. Damping is strong, so what matters is the
// terminal velocity it implies - roughly accel * 0.085 - and the Flame Height
// setting scales this directly. -120 until 1.6.4; slower with the longer
// lives, so a flame climbs about as high as it did, at a calmer pace.
export const FLAME_BUOYANCY = -85;             // cw/s^2

// How long a patch of text keeps burning after the caret has moved off it, at
// Fire Spread = 1. Scaled by the setting. This is what makes the fire linger
// over what you just wrote instead of tracking the caret like a spotlight.
// "Use cursor color" variance. The ramp STARTS at exactly the cursor's colour
// and only lightens with heat - a mix toward white, with a small hue swing -
// so the fire is never darker than the cursor. It used to run the colour's
// value from 0.45x up to 1.15x, which with the temperature range capped at
// half the ramp (HOT_TEMP_MAX) left every chunk below the cursor's
// brightness: on a light theme, whose cursor is dark, that was a black fire.
export const HOT_FLAT_HUE_SPAN = 26;    // degrees, total swing across the ramp
export const HOT_FLAT_LIGHTEN = 0.55;   // how far toward white the hottest end goes

// Where the base of the fire sits relative to the top of the glyphs, as a
// fraction of the font size. NEGATIVE means below that line, i.e. overlapping
// the letters slightly.
//
// Zero would put the base exactly on the glyph tops, which still reads as a
// gap once the particles shrink with age - a flame has to bite into what it
// is burning to look attached to it. A small overlap is what makes the fire
// touch the text instead of hovering over it.
export const HOT_HEAD_LIFT = -0.06;

// Vertical jitter around that base, as a fraction of the line height.
// Asymmetric on purpose: mostly upward, since flames rise, but with a little
// downward room so some particles sit right on the letters rather than every
// one of them starting above. Thin since 1.6.4 (0.16 and 0.05 before): the
// fire starts on ONE line, the tops of the glyphs, and rises from there.
export const HOT_HEAD_JITTER_UP = 0.07;
export const HOT_HEAD_JITTER_DOWN = 0.02;

export const HOT_BURN_LINGER_MS = 240;
export const HOT_BURN_MAX = 64;                // most burn marks kept alive at once (path marks included)
// The trail. In the recording the cursor's PATH burns: fire is left on the
// text it passed over and goes on burning there for a moment, fading. The
// marks behind the caret share the emission by their remaining strength to
// the power HOT_TRAIL_FADE_POW - 1 is linear, the 2 it used to be starved a
// mark of fire as soon as it was a little old and the trail was gone before
// it read as one. The total emission scales with how much is alight up to
// HOT_TRAIL_EMIT_MAX times the single-mark rate (1.6, then 3.6 until 1.6.4:
// "too much trail"), so a trail does not just thin the head out.
//
// The trail burns off the tops of the glyphs like the head. Until 1.6.4 its
// fire was jittered DOWN over the letters by up to half a line (read off the
// recording as fire on the text; upstream in fact never draws a particle
// over text or on the cursor's own cell), and at a row's first or last
// character a share of it licked down over the row below: the trail came
// "from the middle of the cursor, not a headtop trail" (2026-09-24).
export const HOT_TRAIL_FADE_POW = 1;
// The path marks (see updateHotHeadInertia): one every this many characters
// along the way the caret came, at most this many per frame, the far end
// aged by this share of the linger.
export const HOT_TRAIL_STEP_CW = 1.0;
export const HOT_TRAIL_PATH_MAX = 24;
export const HOT_TRAIL_PATH_AGE = 0.35;
export const HOT_TRAIL_EMIT_MAX = 2.4;
