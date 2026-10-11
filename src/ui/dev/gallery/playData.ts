/** The play gallery's sample data (play.tsx, playSamples.tsx), shaped like GameScreen's props. */
import type { Goal } from "@/lib/goalTracker";
import type { AbilityTimer } from "@/components/game/GameCanvas";
import { simNow } from "@/lib/simClock";
import type { ActiveMapMutator } from "@/types/mapMutator";
import type { UpgradeTag } from "@/types/upgrade";

export const ACCENT = "#00ff88";
export const noop = () => {};

export const goal = (g: Partial<Goal> & Pick<Goal, "key" | "kind" | "labelKey">): Goal => ({
  tier: "requirement", current: 0, target: null, done: false, over: false, progress: null, ...g,
});

/** An ordinary map: space required, locks as a tally, the par budget. */
export const BASIC_GOALS: Goal[] = [
  goal({ key: "space", kind: "space", labelKey: "winGate.space", unit: "percent", current: 41, target: 75 }),
  goal({ key: "locks", kind: "locks", tier: "tally", labelKey: "winGate.locks", current: 1 }),
  goal({ key: "par", kind: "par", tier: "budget", labelKey: "goal.par", current: 3, target: 8 }),
];

/** A busy map: four requirements (one at risk, one done), the tally, and par blown. */
export const LONG_GOALS: Goal[] = [
  goal({ key: "space", kind: "space", labelKey: "winGate.space", unit: "percent", current: 80, target: 75, done: true }),
  goal({ key: "smashed:shards", kind: "smashed", labelKey: "winGate.smashed_shards", smashClass: "shards", current: 2, target: 3 }),
  goal({ key: "lockType:purple", kind: "lockType", labelKey: "winGate.lockType", ballType: "purple", current: 0, target: 1 }),
  goal({ key: "superiorLocks", kind: "superiorLocks", labelKey: "winGate.superiorLocks", current: 1, target: 1, done: true }),
  goal({ key: "delivered", kind: "delivered", labelKey: "winGate.delivered", current: 1, target: 2 }),
  goal({ key: "locks", kind: "locks", tier: "tally", labelKey: "winGate.locks", current: 2 }),
  goal({ key: "par", kind: "par", tier: "budget", labelKey: "goal.par", current: 11, target: 8, over: true }),
];

export const GRAVITY: ActiveMapMutator = {
  id: "tipping", name: "Full Gravity", behavior: "gravity",
  description: "Everything on the board falls. Every 10 seconds the pull turns a quarter, and the balls fall the new way.",
};

export const TAGS: UpgradeTag[] = ["lock", "freeze", "bank", "tempo", "risk", "safety"];

export const CHARGES: Record<string, number> = { freezeAll: 2, magnet: 1, shockwave: 3 };

/** Running ability timers on the sim clock (which stands still outside a map, so they hold still here). */
export function timers(n: number): AbilityTimer[] {
  const now = simNow();
  return [
    { kind: "slow", name: "Slow All", color: "#7dd3fc", endMs: now + 6200, durationMs: 10000 },
    { kind: "fenceRush", name: "Fence Overclock", color: "#facc15", endMs: now + 3100, durationMs: 8000 },
    { kind: "fenceShield", name: "Fence Shield", color: "#a78bfa", endMs: now + 9000, durationMs: 12000 },
  ].slice(0, n);
}
