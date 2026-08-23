/**
 * Making a breakable look breakable.
 *
 * Reported twice, and the second time with the diagnosis: the coloured boxes
 * read fine, breakable WALLS do not. The reason was a deliberate old decision
 * that had stopped being right. Breakables were explicitly excluded from the
 * impact bulge on the grounds that their cracks and dent notches already told
 * the story, so a breakable wall took a hit and sat there, indistinguishable
 * from the solid wall beside it until the moment it shattered.
 *
 * Cracks say "this HAS been damaged". The give is what says "this CAN be", and
 * it is the part a player reads before committing a ball to smashing something.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BALL = read("../lib/physics/updateBall.ts");
const OBJ = read("../lib/rendering/sleek/objectLayer.ts");
const DESTR = read("../lib/physics/destructibles.ts");

describe("a struck breakable registers an impact", () => {
  it("no longer excludes breakables from the bulge", () => {
    // The old guard read: !wall.isMirror && d?.kind !== 'breakable' && ...
    const guard = BALL.slice(BALL.indexOf("if (!wall.isMirror"), BALL.indexOf("if (!wall.isMirror") + 120);
    expect(guard).not.toMatch(/kind !== 'breakable'/);
  });

  it("still excludes mirrors, which are the wrong material to flex", () => {
    // Glass that bends reads as rubber; mirrors carry a specular treatment that
    // already says breakable.
    expect(BALL).toMatch(/d\?\.kind !== 'mirror'/);
  });
});

describe("the object layer draws the give", () => {
  it("dents the hull it draws", () => {
    expect(OBJ).toMatch(/dentedContour\(/);
    expect(OBJ).toMatch(/obstacleBulgeAt\(/);
  });

  it("routes every object through one prep, so none is left flat", () => {
    // Breakables, chests, mirrors and phasing bodies all share prep(): denting
    // there is what stops this being fixed for one kind and missed for three.
    const prep = OBJ.slice(OBJ.indexOf("private prep("), OBJ.indexOf("private rimEdges("));
    expect(prep).toMatch(/dentedContour/);
    expect(prep).toMatch(/snapContour/);
  });

  it("keeps the snapped fast path when nothing has been hit", () => {
    expect(OBJ).toMatch(/anyObstacleImpactsActive\(\)\s*\?\s*dentedContour/);
  });

  it("subdivides, or a four-corner slab would just move", () => {
    expect(OBJ).toMatch(/DENT_STEP/);
  });

  it("displaces in world units, so a tilted board dents the right way", () => {
    expect(OBJ).toMatch(/obstacleBulgeAt\(wx, wy, 1\)/);
  });

  it("agrees with the static slabs on how far things dent", () => {
    // A breakable slab and a solid one denting by different amounts would read
    // as two materials rather than the same board furniture.
    const entity = read("../lib/rendering/sleek/entityLayer.ts");
    const stepOf = (src: string) => Number(src.match(/const DENT_STEP = (\d+)/)![1]);
    expect(stepOf(OBJ)).toBe(stepOf(entity));
  });
});

/**
 * The chips existed the whole time. They were simply too small to see: the
 * board renders at roughly 0.45 scale on a phone, so the old 3-unit floor put
 * the smallest flecks at 1.4 screen pixels and half of every burst was wasted.
 */
describe("chips you can actually see", () => {
  /**
   * Scoped to spawnImpactChips, not the whole file. Reading the first `size:`
   * in destructibles.ts matched the fence-shatter debris instead, so the first
   * version of this test happily passed with the chip floor put back to the
   * invisible value it was reported at.
   */
  const CHIPS = DESTR.slice(
    DESTR.indexOf("function spawnImpactChips("),
    DESTR.indexOf("function makeFalling("),
  );
  const num = (re: RegExp, src = DESTR) => Number(src.match(re)![1]);
  const PHONE_SCALE = 0.45;

  it("is reading the chip burst, not some other debris", () => {
    expect(CHIPS.length, "the slice must contain the function").toBeGreaterThan(200);
    expect(CHIPS).toMatch(/CHIP_DURATION_MS/);
  });

  it("keeps the smallest chip above a pixel and a half on a phone", () => {
    const floor = num(/size: (\d+) \+ Math\.random\(\)/, CHIPS);
    expect(floor * PHONE_SCALE).toBeGreaterThan(1.5);
  });

  it("throws more of them", () => {
    const base = num(/const N = (\d+) \+ Math\.round/, CHIPS);
    expect(base).toBeGreaterThanOrEqual(6);
  });

  it("lasts long enough to be caught out of the corner of an eye", () => {
    // A player watching the ball, not the wall it just hit, needs longer than
    // half a second to notice anything happened over there.
    expect(num(/const CHIP_DURATION_MS = (\d+)/)).toBeGreaterThan(600);
  });

  it("stays smaller than the full shatter, so a break still reads bigger", () => {
    const chip = num(/size: (\d+) \+ Math\.random\(\) \* \d+/, CHIPS);
    expect(chip).toBeLessThan(20);
  });

  it("still sheds only on non-fatal hits", () => {
    // The fatal hit has its own full shatter; doubling up would read as two
    // events for one break.
    expect(DESTR).toMatch(/if \(d\.hits < d\.maxHits\) \{/);
  });
});
