/**
 * The canvas FenceSlotBar (src/ui/game/FenceSlotBar.tsx), carried over from
 * fenceSlotBar.test.tsx, fenceSwitchingIntro.test.tsx, fenceSlotsTutorial.test.ts
 * and playgroundFenceTypes.test.ts. The rules live in bottomModel.ts; the few
 * that are about wiring are pinned against the component's source.
 *
 * A MODE selector, not a consumable bar: no charge count, the selection
 * persists, and slot 1 can never be emptied. And it never changes size, because
 * it sits directly under the edge of the board where cuts are drawn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllFenceTypes, getFenceType, standardFenceType, FENCE_SLOTS } from "@/lib/fences";
import { ACQUIRABLE_SLOTS, fenceSlotsFrom } from "@/lib/fenceOwnership";
import {
  fenceSlotRoster, fenceSlotViews, fenceSlotLook, fenceSlotPress, firstUnseenFence, shouldFileFenceManual,
  cssColor, TOUCH_TARGET,
} from "@/ui/game/bottomModel";
import { HUD } from "@/ui/game/hudMetrics";
import { HOLD_MS } from "@/ui/kit/press";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/FenceSlotBar.tsx"), "utf8");
const ids = (slotIds: string[]) => fenceSlotRoster(slotIds).owned.map(f => f.id);

beforeEach(() => localStorage.clear());

describe("the bar is always the same size", () => {
  it("draws five slots with nothing owned", () => {
    const { owned, empties } = fenceSlotRoster([]);
    expect(owned).toHaveLength(1);
    expect(owned.length + empties).toBe(FENCE_SLOTS);
  });

  it("draws five slots with everything owned", () => {
    const others = getAllFenceTypes().filter(f => f.id !== "standard").slice(0, 4).map(f => f.id);
    const { owned, empties } = fenceSlotRoster(others);
    expect(owned).toHaveLength(FENCE_SLOTS);
    expect(empties).toBe(0);
  });

  it("never grows past five for a PLAYER, by the rule that owns that", () => {
    expect(ACQUIRABLE_SLOTS + 1).toBe(FENCE_SLOTS);
    const all = getAllFenceTypes().filter(f => f.id !== "standard").map(f => f.id);
    expect(fenceSlotRoster(fenceSlotsFrom(all)).owned).toHaveLength(FENCE_SLOTS);
  });

  it("draws every type it is handed, when it is handed more", () => {
    // The Playground hands over the whole catalogue; hiding one there is worse.
    const many = getAllFenceTypes().map(f => f.id);
    expect(many.length).toBeGreaterThan(FENCE_SLOTS);
    const got = ids(many);
    expect(got).toHaveLength(many.length);
    expect(got.filter(id => id === "standard")).toHaveLength(1);
    expect(got[0]).toBe("standard");
  });

  it("is exactly one row tall, with 44px targets in it", () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
    // The DOM row was py-1 around 44px buttons.
    expect(HUD.fenceRow).toBe(TOUCH_TARGET + 8);
    expect(SRC).toMatch(/height: HUD\.fenceRow/);
  });
});

describe("slot 1 is the ordinary fence, always", () => {
  it("shows standard even when the roster is empty", () => {
    expect(ids([])).toEqual([standardFenceType().id]);
  });

  it("shows it first, whatever the roster says", () => {
    expect(ids(["ice", "flare"])[0]).toBe("standard");
  });

  it("cannot be pushed out by a roster that names it", () => {
    const got = ids(["standard", "ice"]);
    expect(got.filter(id => id === "standard")).toHaveLength(1);
    expect(got).toContain("ice");
  });
});

describe("selecting is a mode, not a spend", () => {
  it("reports the tapped type", () => {
    const onSelect = vi.fn();
    const openInfo = vi.fn();
    fenceSlotPress(getFenceType("ice"), onSelect, openInfo).onTap();
    expect(onSelect).toHaveBeenCalledWith("ice");
    expect(openInfo).not.toHaveBeenCalled();
  });

  it("does not select on a long press, it explains", () => {
    const onSelect = vi.fn();
    const openInfo = vi.fn();
    fenceSlotPress(getFenceType("ice"), onSelect, openInfo).onHold();
    expect(onSelect).not.toHaveBeenCalled();
    expect(openInfo).toHaveBeenCalledWith(getFenceType("ice"));
  });

  it("marks the selected slot, and only that one", () => {
    const { owned } = fenceSlotRoster(["ice", "flare"]);
    const views = fenceSlotViews(owned, "ice", "#00ff88", false);
    expect(views.filter(v => v.selected).map(v => v.fence.id)).toEqual(["ice"]);
    expect(fenceSlotLook(true).fillAlpha).toBeGreaterThan(fenceSlotLook(false).fillAlpha);
    expect(fenceSlotLook(true).alpha).toBeGreaterThan(fenceSlotLook(false).alpha);
  });

  it("shows no charge count anywhere", () => {
    // AbilityBar renders "x{count}"; a number here would say the type runs out.
    const { owned } = fenceSlotRoster(["ice", "flare"]);
    for (const v of fenceSlotViews(owned, "standard", "#00ff88", false)) {
      expect(v.fence.name).not.toMatch(/x\d/);
      expect(Object.keys(v)).not.toContain("count");
    }
    expect(SRC, "the slot bar grew a charge counter").not.toMatch(/`x\$\{/);
  });

  it("draws each slot in its fence's own colour", () => {
    const { owned } = fenceSlotRoster(["ice"]);
    const views = fenceSlotViews(owned, "standard", "#123456", false);
    expect(views[1].color).toBe(cssColor(getFenceType("ice").color));
  });
});

describe("the explainer", () => {
  it("opens on a long press and is the fence card", () => {
    expect(SRC).toMatch(/onHold=\{press\.onHold\}/);
    expect(SRC).toMatch(/<FenceTypeInfoModal fence=\{info\}/);
  });

  it("holds the type's card behind the switching overlay, QUEUED not dropped", () => {
    expect(SRC).toMatch(/setPendingInfoId\(fresh\.id\)/);
    expect(SRC).toMatch(/if \(!pendingInfoId \|\| deferAutoInfo\) return;/);
  });

  it("marks the type seen when it is FOUND, not when its card opens", () => {
    expect(SRC).toMatch(/markFenceTypeSeen\(fresh\.id\); setPendingInfoId\(fresh\.id\)/);
  });

  it("offers the card for the first unseen special only", () => {
    const { owned } = fenceSlotRoster(["ice", "flare"]);
    expect(firstUnseenFence(owned, () => false)?.id).toBe("ice");
    expect(firstUnseenFence(owned, id => id === "ice")?.id).toBe("flare");
    expect(firstUnseenFence(owned, () => true)).toBeUndefined();
    // Standard never gets a first-acquire card.
    expect(firstUnseenFence(fenceSlotRoster([]).owned, () => false)).toBeUndefined();
  });

  it("files the Manual entry on acquiring one, for a run that started past level 3", () => {
    expect(SRC).toMatch(/fileManualEntry\("fenceSlots"\)/);
    expect(shouldFileFenceManual(1), "filed for a bar holding nothing but the standard fence").toBe(false);
    expect(shouldFileFenceManual(2)).toBe(true);
  });
});

describe("the hold hint", () => {
  it("makes a holdable element look holdable", () => {
    expect(SRC, "the Info hint icon is gone").toMatch(/<HoldHint /);
    expect(HOLD_MS).toBe(450);
  });
});

describe("the Guardrail slot shows its shield", () => {
  const shieldOf = (id: string, spent: boolean) =>
    fenceSlotViews(fenceSlotRoster(["guardrail", "ice"]).owned, "standard", "#00ff88", spent)
      .find(v => v.fence.id === id)!.shield;

  it("lit while the shield is up, struck out once it is spent", () => {
    expect(shieldOf("guardrail", false)).toBe("ready");
    expect(shieldOf("guardrail", true)).toBe("spent");
  });

  it("only on a type that carries a shield", () => {
    expect(shieldOf("ice", false)).toBeNull();
    expect(shieldOf("standard", false)).toBeNull();
  });
});

describe("every slot stays reachable when there are more than five", () => {
  it("lets the row scroll sideways instead of clipping it", () => {
    expect(SRC, "the row is clipped rather than scrollable").toMatch(/<ScrollView direction="horizontal"/);
    // Centred while it fits, left-aligned once it does not.
    // The slot row itself: auto margins, never a centring justify.
    expect(SRC).toMatch(/flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto", marginRight: "auto",/);
  });
});
