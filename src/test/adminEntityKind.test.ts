/**
 * The builder can say what an object IS, not just what it is called.
 *
 * Reported: selecting something in the map builder tells you its name and
 * nothing else. The list showed an id and a shape icon, so a mover, a bumper, a
 * portal, a launcher and a plain slab were five different mechanics all reading
 * as "a rectangle called wall-1738", and the properties heading above the
 * editor said "Rectangle Properties" over a bumper.
 *
 * entityAddType is the INVERSE of MapBuilder's addEntity, which is why it is
 * tested rather than eyeballed: the two are one fact stated twice - what makes
 * an object a bumper - and the discriminators are not obvious. A kicker is a
 * bumper with a bearing. A portal is a plain circular wall carrying a link id.
 * A deformable and a breakable are both `kind: 'wall'` rectangles. A mapping
 * that drifts from the creator highlights the WRONG button, which is worse than
 * highlighting none.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { entityAddType, entityQualifiers, ADD_TYPE_LABEL } from "@/lib/admin/entityKind";
import type { LevelEntity } from "@/types/level";
import type { AddEntityType } from "@/components/admin/EntityPanel";

const e = (o: Record<string, unknown>) => o as unknown as LevelEntity;

describe("reading an object's palette type back off it", () => {
  it.each([
    ["plain rect", { kind: "wall", shape: "rect" }, "rect"],
    ["plain circle", { kind: "wall", shape: "circle" }, "circle"],
    ["polygon", { kind: "wall", shape: "polygon" }, "polygon"],
    ["moving rect", { kind: "mover", shape: "rect" }, "mover-rect"],
    ["moving circle", { kind: "mover", shape: "circle" }, "mover-circle"],
    ["bumper", { kind: "wall", shape: "circle", bouncer: true }, "bouncer"],
    ["deformable", { kind: "wall", shape: "rect", deformable: true }, "deformable"],
    ["portal", { kind: "wall", shape: "circle", portal: "p1a2" }, "portal"],
    ["launcher", { kind: "launcher", shape: "rect" }, "launcher"],
    ["cage", { kind: "cage", shape: "rect" }, "cage"],
    ["delivery box", { kind: "box", shape: "rect" }, "box"],
  ])("reads a %s", (_name, entity, expected) => {
    expect(entityAddType(e(entity))).toBe(expected);
  });

  it("tells a kicker from the bumper it is a variant of", () => {
    // A kicker IS a bouncer with a bearing, so the narrower test has to come
    // first. Reversed, every kicker reads as a plain bumper and the panel
    // lights the wrong button.
    const kicker = e({ kind: "wall", shape: "circle", bouncer: true, bounceBearing: "right" });
    expect(entityAddType(kicker)).toBe("kicker");
    expect(entityAddType(e({ kind: "wall", shape: "circle", bouncer: true }))).toBe("bouncer");
  });

  it("says nothing rather than guessing at an object no button makes", () => {
    // Hand-written YAML can carry a combination the palette cannot produce.
    // Calling that "a rectangle" is how a mapping starts lying.
    expect(entityAddType(e({ kind: "sprocket", shape: "rect" }))).toBeNull();
  });

  it("names every type it can return", () => {
    // A type with no label renders as `undefined` in the heading.
    const kinds: AddEntityType[] = [
      "circle", "polygon", "rect", "mover-rect", "mover-circle",
      "bouncer", "kicker", "portal", "deformable", "launcher", "cage", "box",
    ];
    for (const k of kinds) expect(ADD_TYPE_LABEL[k], k).toBeTruthy();
  });
});

describe("the flags that are not their own palette type", () => {
  it("says a rect is breakable, since the button cannot", () => {
    // Breakable is a checkbox, not a button, so the type alone calls a
    // breakable slab and a plain one both "Rectangle" while the board draws
    // one of them gold.
    expect(entityQualifiers(e({ kind: "wall", shape: "rect", breakable: true })))
      .toContain("breakable");
    expect(entityQualifiers(e({ kind: "wall", shape: "rect" }))).toEqual([]);
  });

  it("calls a chest a chest rather than a breakable", () => {
    // A chest implies breakable; listing both would be noise.
    const q = entityQualifiers(e({ kind: "wall", shape: "rect", breakable: true, chest: true }));
    expect(q).toContain("chest");
    expect(q).not.toContain("breakable");
  });
});

/**
 * The two halves of the report, checked where they live. Source-level because
 * the failure is structural - a button with no highlight branch, or a row that
 * cannot wrap - and standing up the whole builder to assert a CSS class would
 * be a large fragile thing guarding one attribute.
 */
describe("the panel shows it", () => {
  const SRC = readFileSync(
    resolve(process.cwd(), "src/components/admin/EntityPanel.tsx"), "utf8",
  );

  it("highlights the palette button for the selected object", () => {
    const kinds = [
      "circle", "polygon", "rect", "mover-rect", "mover-circle",
      "bouncer", "kicker", "portal", "deformable", "launcher", "cage", "box",
    ];
    for (const k of kinds) {
      expect(SRC, `the ${k} button never lights up when one is selected`)
        .toContain(`sel('${k}')`);
    }
  });

  it("wraps the type rows instead of running them off the edge", () => {
    // Twelve buttons across two rows in a side panel: without wrapping the
    // last ones are simply not reachable.
    expect(SRC, "a palette row still cannot wrap").not.toMatch(/className="flex gap-1"/);
    expect(SRC).toContain('className="flex flex-wrap justify-end gap-1"');
  });

  it("heads the editor with the type, not the shape", () => {
    expect(SRC, 'the heading is back to "Rectangle Properties" over a bumper')
      .not.toContain("{getShapeLabel(selectedEntity.shape)} Properties");
    expect(SRC).toContain("{describeEntity(selectedEntity)} Properties");
  });
});
