/**
 * Which palette button made this object, read back off the object.
 *
 * The builder's list shows an id and a shape icon, so a mover, a bumper, a
 * portal, a launcher and a plain slab are five different mechanics that all
 * render as "a rectangle called wall-1738". Reported as: selecting something
 * tells you its name and nothing about what it IS.
 *
 * This is the inverse of MapBuilder's `addEntity`, and it is a separate tested
 * function for exactly that reason. The two are one fact stated twice - what
 * makes an object a bumper - and the discriminators are not obvious: a bumper
 * and a kicker are the same flag apart from a bearing, a portal is a plain
 * circle wall carrying a link id, and a deformable and a breakable are both
 * `kind: 'wall'` rectangles. A mapping that drifts from the creator would
 * highlight the wrong button, which is worse than highlighting none.
 */
import type { LevelEntity } from "@/types/level";
import type { AddEntityType } from "@/components/admin/EntityPanel";

/**
 * The palette type an entity belongs to, or null when nothing placed it.
 *
 * Null is a real answer rather than a fallback: an object hand-written into the
 * YAML can carry a combination no button produces, and quietly calling that
 * "a rectangle" is how a mapping starts lying.
 */
export function entityAddType(entity: LevelEntity): AddEntityType | null {
  const e = entity as LevelEntity & {
    bouncer?: boolean; bounceBearing?: string; deformable?: boolean; portal?: string;
  };

  if (entity.kind === "mover") {
    return entity.shape === "circle" ? "mover-circle" : "mover-rect";
  }
  if (entity.kind === "launcher") return "launcher";
  if (entity.kind === "cage") return "cage";
  if (entity.kind === "box") return "box";

  if (entity.kind === "wall") {
    // Order matters: a kicker IS a bouncer with a bearing, so the narrower
    // test has to come first or every kicker reads as a plain bumper.
    if (e.bouncer) return e.bounceBearing ? "kicker" : "bouncer";
    if (e.deformable) return "deformable";
    if (e.portal) return "portal";
    if (entity.shape === "circle") return "circle";
    if (entity.shape === "rect") return "rect";
    if (entity.shape === "polygon") return "polygon";
  }
  return null;
}

/** What to call it on screen. Sentence case, because it sits in a heading. */
export const ADD_TYPE_LABEL: Record<AddEntityType, string> = {
  circle: "Circle",
  polygon: "Polygon",
  rect: "Rectangle",
  "mover-rect": "Moving rectangle",
  "mover-circle": "Moving circle",
  bouncer: "Bumper",
  kicker: "Kicker",
  portal: "Portal",
  deformable: "Padded block",
  launcher: "Launcher",
  cage: "Cage",
  box: "Delivery box",
};

/**
 * The extra words a flag adds to the name.
 *
 * A breakable rectangle and a plain one are the same palette type - breakable
 * is a checkbox, not a button - so the type alone would call them both
 * "Rectangle" while the board draws one of them gold. Worth saying, since it is
 * the property most likely to be the reason you selected the thing.
 */
export function entityQualifiers(entity: LevelEntity): string[] {
  const e = entity as LevelEntity & {
    breakable?: boolean; chest?: boolean; mirror?: boolean; objective?: boolean;
    oneWay?: string; phasing?: unknown;
  };
  const out: string[] = [];
  if (e.chest) out.push("chest");
  else if (e.breakable) out.push("breakable");
  if (e.mirror) out.push("mirror");
  if (e.objective) out.push("objective");
  if (e.oneWay) out.push("one-way");
  if (e.phasing) out.push("phasing");
  return out;
}
