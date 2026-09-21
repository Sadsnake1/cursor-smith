// Painting the cursor, gathered: colour, the blink, the shape, the energy
// beam, the bracket tether, the secondaries, the motion smear, and the frame
// (draw() in the order the layers stack). By what it paints since 1.5.8 -
// paint-color.ts, paint-blink.ts, paint-shape.ts, paint-energy.ts,
// paint-tether.ts, paint-secondaries.ts, paint-smear.ts, paint-frame.ts -
// and merged here into the one object plugin.ts assigns onto the prototype
// and declares from (PaintMethods["x"]). The smear is a two-point quad since
// 1.5.6 (a sprung leading point, a lagging trailing one; HANDOFF §2).
import { paintColorMethods } from "./paint-color";
import { paintBlinkMethods } from "./paint-blink";
import { paintShapeMethods } from "./paint-shape";
import { paintEnergyMethods } from "./paint-energy";
import { paintTetherMethods } from "./paint-tether";
import { paintSecondariesMethods } from "./paint-secondaries";
import { paintSmearMethods } from "./paint-smear";
import { paintFrameMethods } from "./paint-frame";

export const paintMethods = {
  ...paintColorMethods,
  ...paintBlinkMethods,
  ...paintShapeMethods,
  ...paintEnergyMethods,
  ...paintTetherMethods,
  ...paintSecondariesMethods,
  ...paintSmearMethods,
  ...paintFrameMethods,
};
export type PaintMethods = typeof paintMethods;
