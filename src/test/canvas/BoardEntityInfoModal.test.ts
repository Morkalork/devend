/**
 * The canvas BoardEntityInfoModal's copy (src/ui/game/BoardEntityInfoModalModel.ts),
 * carrying over the behavioural checks of boardEntityInfoModal.test.tsx and
 * bugCodex.test.tsx: a missing locale key renders the RAW KEY and nothing
 * crashes, so every kind the hit-test can return must produce real prose, and a
 * carrying shard must show the upside AND the cost.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { BoardEntityKind } from "@/lib/boardEntityInfo";
import { getBug } from "@/lib/bugs";
import { boardEntityCopy, type BoardEntityCopy } from "@/ui/game/BoardEntityInfoModalModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const en = JSON.parse(read("src/i18n/locales/en.json"));

/** Every string the card would show, as the DOM test read document.body.textContent. */
const allText = (c: BoardEntityCopy) => [
  c.title, c.body, c.hint,
  c.bug?.givesLabel, c.bug?.gives, c.bug?.costsLabel, c.bug?.costs, c.bug?.danger,
].filter(Boolean).join(" ");

/** Every kind boardEntityAt can return. */
const KINDS: BoardEntityKind[] = [
  "pickup", "chestLoot", "dormantBall", "terminal", "ball",
  "chest", "objective", "breakable", "mirror", "mover",
  "phasing", "obstacle", "area",
];

describe("board entity explainer copy (canvas)", () => {
  it.each(KINDS)("gives %s a real title and body, not a raw key", kind => {
    const text = allText(boardEntityCopy(t, { kind }, "#00ff88"));
    expect(text).not.toContain("boardInfo.");
    expect(text.length).toBeGreaterThan(40);
  });

  it("shows the reusable hint, so the gesture teaches itself", () => {
    expect(boardEntityCopy(t, { kind: "mirror" }, "#00ff88").hint).toMatch(/Hold anything on the board/);
  });

  it("explains a mirror in terms of what it does to the player", () => {
    const c = boardEntityCopy(t, { kind: "mirror" }, "#00ff88");
    expect(c.title).toMatch(/Mirror/);
    expect(c.body).toMatch(/hard angles/);
  });

  it("titles an ordinary object in the accent", () => {
    expect(boardEntityCopy(t, { kind: "mirror" }, "#123456").titleColor).toBe("#123456");
  });
});

describe("a bug shard's card (canvas)", () => {
  it("says what is in there, and what it will cost", () => {
    const bug = getBug("forcePush")!;
    const c = boardEntityCopy(t, { kind: "bugShard", detail: "forcePush" }, "#00ff88");
    expect(c.title).toBe(bug.name);
    expect(c.titleColor).toBe(bug.color);
    expect(c.bug?.gives).toBe(bug.description);
    expect(c.bug?.costs, "the card shows the upside and hides the cost").toBe(bug.cost);
    expect(c.body).toBe(en.boardInfo.bugShard.body);
  });

  it("carries the danger warning on the dangerous one, and only there", () => {
    const danger = en.boardInfo.bugShard.danger;
    expect(boardEntityCopy(t, { kind: "bugShard", detail: "bigBang" }, "#00ff88").bug?.danger).toBe(danger);
    expect(boardEntityCopy(t, { kind: "bugShard", detail: "bitRot" }, "#00ff88").bug?.danger,
      "every shard looks dangerous").toBeUndefined();
  });

  it("still explains SOMETHING when the catalogue could not be fetched", () => {
    const c = boardEntityCopy(t, { kind: "bugShard", detail: "notARealBug" }, "#00ff88");
    expect(c.title).toBe(en.boardInfo.bugShard.title);
    expect(c.body).toBe(en.boardInfo.bugShard.body);
    expect(c.bug).toBeUndefined();
  });

  it("left every other board object's explainer exactly as it was", () => {
    const c = boardEntityCopy(t, { kind: "pickup", detail: "overtime" }, "#00ff88");
    expect(c.title).toBe(en.boardInfo.pickup.title);
    expect(c.body).toBe(en.boardInfo.pickup.body);
  });

  it("reads the catalogue rather than restating it", () => {
    // Source check, as in bugCodex.test.tsx: a rebalanced bug must not keep an
    // old card because the port hardcoded a sentence.
    const model = read("src/ui/game/BoardEntityInfoModalModel.ts");
    expect(model).toContain("getBug(");
    expect(model).toMatch(/bug\.description/);
    expect(model).toMatch(/bug\.cost/);
  });

  it("keeps the close button outside the scrolling body", () => {
    // The DOM test's structural check, as a source check: the X is a sibling
    // after the ScrollView, not inside it.
    const src = read("src/ui/game/BoardEntityInfoModal.tsx");
    const scrollEnd = src.indexOf("</ScrollView>");
    const close = src.indexOf('label="close"');
    expect(scrollEnd).toBeGreaterThan(0);
    expect(close, "the close button scrolls with the text").toBeGreaterThan(scrollEnd);
    expect(src).toMatch(/maxHeight: screen\.height - 48/);
  });
});
