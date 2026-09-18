// The particle effects, gathered: each one a spawn that bakes the whole
// effect once and a draw that positions it as a pure function of time (see
// ARCHITECTURE, "How an effect is built"). By effect since 1.5.6 -
// effects-fire.ts (Hot-head), effects-pops.ts (letters, glitch, fireworks,
// thunderbolts, the rainbow), effects-dust.ts (pixel trail, jump trail,
// stardust), effects-trail.ts (the CRT ghosts, Speed demon's sparks) -
// and merged here into the one object plugin.ts assigns onto the prototype
// and declares from (EffectsMethods["x"]).
import { effectsFireMethods } from "./effects-fire";
import { effectsPopsMethods } from "./effects-pops";
import { effectsDustMethods } from "./effects-dust";
import { effectsTrailMethods } from "./effects-trail";

export const effectsMethods = {
  ...effectsFireMethods,
  ...effectsPopsMethods,
  ...effectsDustMethods,
  ...effectsTrailMethods,
};
export type EffectsMethods = typeof effectsMethods;
