/**
 * The player-behaviour events (src/lib/analytics.ts, src/lib/gameTelemetry.ts):
 * the local log Admin reads, the mute Admin sets, and the map-side reporters.
 * Tests run with no PostHog key, so nothing is ever sent from here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  analytics, clearSessionEvents, getSessionEvents, isAnalyticsMuted, setAnalyticsLevel, setAnalyticsMuted, setAnalyticsRun,
  SESSION_LOG_MAX,
} from "@/lib/analytics";
import { reportFenceFinished, reportFreezeTap, reportLifeLost } from "@/lib/gameTelemetry";
import { ADMIN_SCREENS, reportScreen } from "@/hooks/useScreenNavigation";
import { MAP_FAIL_KINDS, type MapFailure } from "@/lib/mapFailure";
import type { CanvasGameState } from "@/types/gameState";

const last = () => getSessionEvents()[getSessionEvents().length - 1];

const game = (over: Partial<CanvasGameState> = {}): CanvasGameState => ({
  activePlaySeconds: 42.4,
  mapMutator: null,
  ...over,
}) as unknown as CanvasGameState;

const failure = (kind: MapFailure["kind"]): MapFailure => ({ kind, unmet: [] }) as unknown as MapFailure;

beforeEach(() => {
  clearSessionEvents();
  setAnalyticsMuted(false);
  setAnalyticsRun({ daily: false });
  setAnalyticsLevel(0);
});

describe("the session log", () => {
  it("lists every event, marked unsent without a key", () => {
    analytics.shopSkipped({ level: 4, overtimeBanked: 30 });
    expect(last().event).toBe("shop_skipped");
    expect(last().props).toEqual({ level: 4, overtimeBanked: 30 });
    expect(last().sent).toBe(false);
  });

  it("keeps only the newest events", () => {
    for (let i = 0; i < SESSION_LOG_MAX + 10; i++) {
      analytics.screenViewed({ screen: `s${i}` });
    }
    expect(getSessionEvents().length).toBe(SESSION_LOG_MAX);
    expect(last().props.screen).toBe(`s${SESSION_LOG_MAX + 9}`);
  });
});

describe("life_lost", () => {
  it("carries the failure kind, the time in, the lives left, the mutator and the run's daily flag", () => {
    setAnalyticsRun({ daily: true });
    reportLifeLost(game({ mapMutator: { id: "spike" } as CanvasGameState["mapMutator"] }), 34, failure("timeUp"), 1);
    expect(last().event).toBe("life_lost");
    expect(last().props).toEqual({ level: 34, reason: "timeUp", seconds: 42, livesLeft: 1, mutator: "spike", daily: true });
  });

  it("names every kind of failure the game has", () => {
    for (const kind of MAP_FAIL_KINDS) {
      reportLifeLost(game(), 1, failure(kind), 0);
      expect(last().props.reason).toBe(kind);
    }
  });

  it("never reports negative lives", () => {
    reportLifeLost(game(), 1, failure("ballHitFence"), -1);
    expect(last().props.livesLeft).toBe(0);
  });
});

describe("fence_type_used", () => {
  it("skips the standard fence, and reports each other type once per map", () => {
    const g = game();
    const before = getSessionEvents().length;
    reportFenceFinished(g, 9, "standard");
    reportFenceFinished(g, 9, undefined);
    expect(getSessionEvents().length).toBe(before);
    reportFenceFinished(g, 9, "guardrail");
    reportFenceFinished(g, 9, "guardrail");
    expect(getSessionEvents().length).toBe(before + 1);
    expect(last().props).toEqual({ fenceTypeId: "guardrail", level: 9 });
    reportFenceFinished(game(), 10, "guardrail");
    expect(getSessionEvents().length).toBe(before + 2);
  });
});

describe("ability_used", () => {
  it("fills in the map being played when the caller does not know it", () => {
    setAnalyticsLevel(17);
    reportFreezeTap(false);
    expect(last().props).toEqual({ abilityId: "featureFreeze", level: 17 });
    reportFreezeTap(true);
    expect(last().props.abilityId).toBe("freezeCharge");
  });
});

describe("screens and the Admin mute", () => {
  it("reports a player's screen", () => {
    reportScreen("certificateStore");
    expect(last().props).toEqual({ screen: "certificateStore" });
    expect(isAnalyticsMuted()).toBe(false);
  });

  it("mutes on any Admin screen instead of reporting it", () => {
    const before = getSessionEvents().length;
    for (const screen of ADMIN_SCREENS) {
      reportScreen(screen);
    }
    expect(getSessionEvents().length).toBe(before);
    expect(isAnalyticsMuted()).toBe(true);
  });

  it("still lists events while muted, as unsent", () => {
    setAnalyticsMuted(true);
    analytics.certStoreOpened();
    expect(last().event).toBe("cert_store_opened");
    expect(last().sent).toBe(false);
  });
});
