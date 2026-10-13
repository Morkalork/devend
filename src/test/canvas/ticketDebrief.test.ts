/**
 * The Debrief as the map's ticket: "I would prefer if the post-map summary was
 * the very card shown before the map, with the contents filled in (green check
 * mark for succeeded, red x if not). Let's try it for a while without all of
 * the other overwhelming information."
 *
 * The criteria now carry a check (lib/winConditions.ts CriterionCheck), the
 * win marks each one on the board as it stands (applyCut acceptanceMarks),
 * GameScreen joins the marks to the words the player read, and the Debrief
 * draws the same AcceptanceTicket the pre-map modal does. The full Debrief is
 * kept behind Admin's "Full debrief".
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import { SquareCheckBig, SquareX, Square, CircleX } from "lucide-react";
import { criterionMet, winConditions, type Criterion, type CriterionContext } from "@/lib/winConditions";
import type { WinSnapshot } from "@/types/winSpec";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { acceptanceMarks } from "@/lib/physics/applyCut";
import { createBotGame } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { rowLook } from "@/ui/game/AcceptanceTicketModel";
import { ROLE } from "@/ui/theme";
import { isFullDebrief, setFullDebrief } from "@/ui/screens/debriefMode";
import { LADDER } from "../fixtures/maps";

const t = i18n.t.bind(i18n) as unknown as TFunction;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
afterEach(() => setRunSeedText(null));

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 20, lockedBalls: 2, superiorLocks: 0, delivered: 0,
  smashed: { any: 0, shards: 0, monoliths: 0 } as unknown as WinSnapshot["smashed"],
  terminals: 0, harvested: 0, areaTargets: 0, lockedByType: {}, lockPoints: [], mapRotation: 0,
  bossDefeated: false, allLocked: false, cuts: 4, par: 5, activeSeconds: 30, ...over,
});
const ctx = (over: Partial<CriterionContext> = {}): CriterionContext => ({ snap: snap(), areasSatisfied: [], failure: null, ...over });
const c = (check: Criterion["check"], group: Criterion["group"] = "required"): Criterion => ({ group, text: "", check });

describe("marking a criterion", () => {
  it("reads a goal from its clause on the final board", () => {
    expect(criterionMet(c({ kind: "clause", clause: { kind: "space", threshold: 25 } }), ctx())).toBe(true);
    expect(criterionMet(c({ kind: "clause", clause: { kind: "space", threshold: 10 } }), ctx())).toBe(false);
    expect(criterionMet(c({ kind: "clause", clause: { kind: "locks", count: 3 } }), ctx())).toBe(false);
  });

  it("reads a bonus area by whether a ball was locked in it", () => {
    const area = c({ kind: "bonusArea", areaIndex: 1 }, "optional");
    expect(criterionMet(area, ctx({ areasSatisfied: [false, true] }))).toBe(true);
    expect(criterionMet(area, ctx({ areasSatisfied: [true, false] }))).toBe(false);
  });

  it("counts a failure condition as met when it did not happen", () => {
    const clock = c({ kind: "fail", on: ["timeUp"] }, "fail");
    expect(criterionMet(clock, ctx())).toBe(true);
    expect(criterionMet(clock, ctx({ failure: "outOfFences" }))).toBe(true);
    expect(criterionMet(clock, ctx({ failure: "timeUp" }))).toBe(false);
  });

  it("counts a trade as met only with both halves", () => {
    const trade = c({ kind: "trade", areaIndexes: [0] }, "trade");
    expect(criterionMet(trade, ctx({ areasSatisfied: [true] }))).toBe(true);
    expect(criterionMet(trade, ctx({ areasSatisfied: [false] }))).toBe(false);
  });

  it("leaves a criterion with nothing to check unmarked", () => {
    expect(criterionMet({ group: "required", text: "" }, ctx())).toBeNull();
  });
});

describe("every criterion on the ladder can be marked", () => {
  it.each(LADDER.map(l => [l.level, l] as const))("level %s", (n, level) => {
    // A row with no check would come back from the map with no mark at all,
    // which on a filled-in ticket reads as "forgot to check".
    const unmarked = winConditions(t, level, n, DEFAULT_MODIFIERS).filter(x => !x.check);
    expect(unmarked.map(x => x.text)).toEqual([]);
  });
});

describe("the marks a dealt board gets", () => {
  const deal = (n: number) => {
    setRunSeedText(`ticket-${n}`);
    const level = LADDER.find(l => l.level === n)!;
    return { level, game: createBotGame(level, n).game };
  };

  it("line up with the criteria, one each", () => {
    const { level, game } = deal(11);
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS))
      .toHaveLength(winConditions(t, level, 11, DEFAULT_MODIFIERS).length);
  });

  it("mark the clear unmet on an untouched board, and the bonus area once a ball is locked in it", () => {
    const { level, game } = deal(11);
    const criteria = winConditions(t, level, 11, DEFAULT_MODIFIERS);
    const clear = criteria.findIndex(x => x.check?.kind === "clause" && x.check.clause.kind === "space");
    const bonus = criteria.findIndex(x => x.check?.kind === "bonusArea");
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(bonus).toBeGreaterThanOrEqual(0);
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS)[clear]).toBe(false);
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS)[bonus]).toBe(false);
    const idx = (criteria[bonus].check as { areaIndex: number }).areaIndex;
    game.coloredAreas[idx].satisfied = true;
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS)[bonus]).toBe(true);
  });

  it("mark a failure as happened when the map failed by it", () => {
    const { level, game } = deal(11);
    const criteria = winConditions(t, level, 11, DEFAULT_MODIFIERS);
    const clock = criteria.findIndex(x => x.check?.kind === "fail" && x.check.on.includes("timeUp"));
    expect(clock).toBeGreaterThanOrEqual(0);
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS)[clock]).toBe(true);
    expect(acceptanceMarks(game, level, 11, DEFAULT_MODIFIERS, "timeUp")[clock]).toBe(false);
  });
});

describe("the ticket's marks", () => {
  it("are a green check for met and a red cross for missed", () => {
    expect(rowLook({ group: "required", text: "", met: true }, 0)).toMatchObject({ icon: SquareCheckBig, color: ROLE.pass });
    expect(rowLook({ group: "fail", text: "", met: true }, 0)).toMatchObject({ icon: SquareCheckBig, color: ROLE.pass });
    expect(rowLook({ group: "optional", text: "", met: false }, 0)).toMatchObject({ icon: SquareX, color: ROLE.cost });
  });

  it("say a failure was avoided when every one was, in every language", () => {
    expect(read("src/ui/game/AcceptanceTicket.tsx")).toContain('group === "fail" && failsAvoided ? t("winConditions.groupFailAvoided")');
    for (const l of ["en", "es", "sv"]) {
      const v = JSON.parse(read(`src/i18n/locales/${l}.json`)).winConditions.groupFailAvoided as string;
      expect(v).toBeTruthy();
      expect(v).not.toContain("—");
    }
  });

  it("are the group's glyph before the map, as the pre-map ticket always drew them", () => {
    expect(rowLook({ group: "required", text: "" }, 0x123456)).toMatchObject({ icon: Square, color: 0x123456 });
    expect(rowLook({ group: "fail", text: "" }, 0)).toMatchObject({ icon: CircleX, color: ROLE.cost });
  });
});

describe("the Debrief draws it", () => {
  it("is marked at the win and joined to the player's words in GameScreen", () => {
    const cut = read("src/lib/physics/applyCut.ts");
    expect(cut).toContain("const criteriaMet = acceptanceMarks(game, level, levelNumber, activeModifiers);");
    expect(cut).toContain("        criteriaMet,\n");
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("winConditions(t, level, levelNumber, activeModifiers).map((c, i) => ({");
    expect(screen).toContain("met: marks[i] ?? null,");
  });

  it("opens as the ticket unless Admin asks for the full one, with nothing but the rare notices beside it", () => {
    const src = read("src/ui/screens/LevelCompleteOverlay.tsx");
    expect(src).toContain("const ticket = !(full ?? isFullDebrief()) && !!scoreData.acceptance;");
    const start = src.indexOf("if (ticket && scoreData.acceptance) {");
    expect(start).toBeGreaterThan(0);
    const ticket = src.slice(start, src.indexOf("  return (\n    <PipelineFrame", start));
    expect(ticket).toContain("<AcceptanceTicket rows={scoreData.acceptance}");
    expect(ticket).not.toContain("breakdown");
    expect(ticket).not.toContain("PerformanceReviewAxes");
    expect(ticket).not.toContain("totalOvertime");
    // The pre-map modal draws the same card.
    expect(read("src/ui/game/AcceptanceCriteriaModal.tsx")).toContain("<AcceptanceTicket rows={criteria}");
  });

  it("is switchable in Admin, and defaults to the ticket", () => {
    setFullDebrief(false);
    expect(isFullDebrief()).toBe(false);
    setFullDebrief(true);
    expect(isFullDebrief()).toBe(true);
    setFullDebrief(false);
    const admin = read("src/components/admin/AdminScreen.tsx");
    expect(admin).toContain("setFullDebrief(next)");
    expect(admin).toContain("Full debrief");
  });

  it("has gallery entries, met and missed", () => {
    const g = read("src/ui/dev/gallery/between.tsx");
    expect(g).toContain('id: "LevelCompleteOverlay-ticket"');
    expect(g).toContain('id: "LevelCompleteOverlay-ticketMissed"');
  });
});

// "Do the same for the map failed screen."
describe("the failed screen draws it too", () => {
  it("gets the marks on the way out of the game, on both loss paths", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("criteriaMet: acceptanceMarks(game, level, levelNumber, activeModifiers, failure.kind),");
    expect(canvas).toContain("onMapTimedOut: (failure: MapFailure) => onMapTimedOutRef.current?.(markFailure(failure)),");
    expect(canvas).toContain("onGameEnd: r => onGameEndRef.current(r.failure ? { ...r, failure: markFailure(r.failure) } : r),");
  });

  it("is handed the same rows as the Debrief, for a lost life and for the run's end", () => {
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("acceptance={ticketRows(runEndingLoss.failure.criteriaMet)}");
    expect(screen).toContain("acceptance={ticketRows(mapFailure.criteriaMet)}");
    expect(screen).toContain("const acceptance = ticketRows(scoreData.criteriaMet);");
  });

  it("draws the ticket in place of the lines unless Admin asks for the full screen, without 'avoided'", () => {
    const src = read("src/ui/game/MapFailedOverlay.tsx");
    expect(src).toContain("const [rows] = useState(() => (full ?? isFullDebrief()) ? undefined : acceptance);");
    expect(src).toContain("{!rows && lines.length > 0 && (");
    expect(src).toMatch(/<AcceptanceTicket rows=\{rows\}[\s\S]*?sayAvoided=\{false\} filled=\{fill\.filled\} \/>/);
    expect(read("src/ui/game/AcceptanceTicket.tsx")).toContain("const failsAvoided = sayAvoided && ");
  });

  it("stays up long enough to read the card, and the last life still waits for a tap", async () => {
    const { mapFailedDelay, MAP_FAILED_MS, MAP_FAILED_TICKET_MS, MAP_FAILED_RUN_OVER_MS } = await import("@/ui/game/MapFailedOverlayModel");
    expect(mapFailedDelay(false, true)).toBe(MAP_FAILED_TICKET_MS);
    expect(MAP_FAILED_TICKET_MS).toBeGreaterThan(MAP_FAILED_MS);
    expect(mapFailedDelay(false)).toBe(MAP_FAILED_MS);
    expect(mapFailedDelay(true, true)).toBe(MAP_FAILED_RUN_OVER_MS);
  });

  it("has gallery entries", () => {
    const g = read("src/ui/dev/gallery/modals.tsx");
    for (const id of ["MapFailedOverlay-ticket", "MapFailedOverlay-ticketRunOver", "MapFailedOverlay-full"]) {
      expect(g).toContain(`id: "${id}"`);
    }
  });
});


// "We can now dismiss the end of map exploding game board and instead just show
// the acceptance criteria modal on top of the finished map with overlays, but it
// is important that the card content is filled in one by one, even if quickly."
describe("the card over the finished board", () => {
  it("fills in one row at a time, quickly, after the card has opened", async () => {
    const { fillCount, fillDoneMs, FILL_START_MS, FILL_STEP_MS } = await import("@/ui/game/fillIn");
    expect(fillCount(0, 5)).toBe(0);
    expect(fillCount(FILL_START_MS - 1, 5)).toBe(0);
    expect(fillCount(FILL_START_MS, 5)).toBe(1);
    expect(fillCount(FILL_START_MS + FILL_STEP_MS, 5)).toBe(2);
    expect(fillCount(FILL_START_MS + FILL_STEP_MS * 10, 5)).toBe(5);
    // Every row gets a beat of its own, and a long card is still done fast.
    for (let n = 1; n < 6; n++) expect(fillCount(fillDoneMs(6) - (6 - n) * FILL_STEP_MS, 6)).toBe(n);
    expect(FILL_STEP_MS).toBeGreaterThanOrEqual(150);
    expect(fillDoneMs(8)).toBeLessThan(2500);
  });

  it("marks rows in reading order and leaves the rest as the empty boxes of the pre-map card", () => {
    const src = read("src/ui/game/AcceptanceTicket.tsx");
    expect(src).toContain("const order = order0[section.group] + i;");
    expect(src).toContain("const shown = filled == null || order < filled;");
    expect(src).toContain("const look = rowLook(shown ? item : { ...item, met: undefined }, accent);");
    // "Failure, avoided" only once every row is marked.
    expect(src).toContain("const failsAvoided = sayAvoided && (filled == null || filled >= rows.length) && ");
  });

  it("is a modal over the board, shows the hours only once it is full, the way on always but live only then, and a tap finishes it", () => {
    const src = read("src/ui/screens/LevelCompleteOverlay.tsx");
    const start = src.indexOf("if (ticket && scoreData.acceptance) {");
    const modal = src.slice(start, src.indexOf("  return (\n    <PipelineFrame", start));
    expect(modal).not.toContain("<PipelineFrame");
    expect(modal).toContain("<Pressable onTap={fill.finish}");
    expect(modal).toContain("filled={fill.filled}");
    expect(modal).toContain("estimate={fill.done ? `+${displayLevelScore}h` : undefined}");
    expect(modal).toContain("{renderContinueButton(!fill.done)}");
    expect(modal).not.toContain("{fill.done && continueButton}");
    expect(read("src/ui/game/MapFailedOverlay.tsx")).toContain("const fill = useFillIn(rows?.length ?? 0);");
  });

  it("leaves the board standing: no shatter on a win, a bank, a failed push or the run's end", () => {
    const cut = read("src/lib/physics/applyCut.ts");
    expect(cut).toContain("if (callbacks.keepBoardAtEnd?.()) deliver();\n    else callbacks.startDissolve(deliver);");
    const over = read("src/lib/physics/handleGameOver.ts");
    expect(over.match(/if \(!callbacks\.keepBoardAtEnd\?\.\(\)\) callbacks\.startDissolve\(/g)).toHaveLength(2);
    expect(over).not.toMatch(/^\s*callbacks\.startDissolve\(/m);
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("keepBoardAtEnd: () => !isFullDebrief(),");
    expect(canvas).toContain("if (!isFullDebrief()) deliver();\n      else startDissolveRef.current?.(deliver);");
  });

  it("keeps the overlays up under the card, and the board mounted", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("hold: game.shimmerFrozen || !isFullDebrief() });");
    const index = read("src/pages/Index.tsx");
    expect(index).toContain("(!session.showLevelComplete || !isFullDebrief())");
    // Kept mounted, a skipped store would otherwise feed the next map to the same screen.
    expect(index).toContain("key={`game-${session.gameInstanceKey}-${session.currentLevelIndex}`}");
  });

  it("marks every win, whichever path won it (a bank or a failed push included)", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("const deliverLevelComplete = (d: LevelScoreData) => onLevelCompleteRef.current(d.criteriaMet ? d : {");
    expect(canvas).toContain("onLevelComplete: d => deliverLevelComplete(d),");
    expect(canvas).toContain("deliverLevelCompleteRef.current?.({");
  });
});
