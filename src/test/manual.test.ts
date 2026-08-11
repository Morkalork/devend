/**
 * The Manual's bookkeeping.
 *
 * The distinction that matters is MET vs UNREAD. Met is permanent - the whole
 * point of moving these explanations out of one-shot modals is that they stay
 * reachable - while unread only drives the Specs badge and clears when the panel
 * is opened. Collapsing the two would empty the manual on first read, which is
 * exactly the failure the modals had.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MANUAL_ENTRIES,
  fileManualEntry,
  hasMetManualEntry,
  unreadManualCount,
  markManualRead,
  resetManualCache,
} from "@/lib/manual";

beforeEach(() => {
  localStorage.clear();
  resetManualCache();
});

describe("manual entries", () => {
  it("starts empty", () => {
    expect(unreadManualCount()).toBe(0);
    expect(hasMetManualEntry("mover")).toBe(false);
  });

  it("filing a mechanic makes it met AND badges it", () => {
    fileManualEntry("mover");
    expect(hasMetManualEntry("mover")).toBe(true);
    expect(unreadManualCount()).toBe(1);
  });

  // The core invariant: reading clears the badge, never the manual.
  it("keeps the entry after reading, and drops only the badge", () => {
    fileManualEntry("mover");
    markManualRead();
    expect(unreadManualCount()).toBe(0);
    expect(hasMetManualEntry("mover")).toBe(true);
  });

  it("survives a reload, which is the point of persisting it", () => {
    fileManualEntry("circuit");
    markManualRead();
    resetManualCache(); // fresh page load
    expect(hasMetManualEntry("circuit")).toBe(true);
    expect(unreadManualCount()).toBe(0);
  });

  it("does not double-count a mechanic met twice", () => {
    fileManualEntry("pickup");
    fileManualEntry("pickup");
    expect(unreadManualCount()).toBe(1);
  });

  it("counts several unmet mechanics independently", () => {
    fileManualEntry("mover");
    fileManualEntry("break");
    expect(unreadManualCount()).toBe(2);
  });

  // Ids come from call sites scattered through GameScreen; a typo must not
  // silently badge a phantom entry the panel can never render.
  it("ignores an unknown id rather than storing it", () => {
    fileManualEntry("notAMechanic");
    expect(unreadManualCount()).toBe(0);
  });

  it("gives every entry the i18n keys the panel renders", () => {
    for (const e of MANUAL_ENTRIES) {
      expect(e.titleKey).toMatch(/^game\./);
      expect(e.bodyKey).toMatch(/^game\./);
      expect(e.color).toMatch(/^#/);
    }
  });
});
