/**
 * Which mechanics the ladder actually uses, and how unevenly.
 *
 * Measured across the 35 maps on 2026-08-31, the vocabulary is lopsided enough
 * to be a design problem on its own:
 *
 *     circle        21     mirror          2
 *     coloredArea   19     dataStream      2
 *     breakable     12     pickupSpots     2
 *     mover         11     threadLock      1
 *                          pinned mutator  1
 *
 * Circles and colored areas carry more than half the ladder; thread-lock and
 * pinned mutators appear once each. Nothing in the editor tells you, while
 * authoring act III, that you have reached for `mover` four times and `mirror`
 * not at all - so the easy mechanics keep winning and the rest quietly become
 * things that exist on one map and are never developed.
 *
 * This module answers that question. It is deliberately pure and takes the
 * levels as an argument, so the editor panel and the lint test read the SAME
 * function rather than each deciding for itself what "uses a mover" means.
 */
import type { LevelConfig, LevelEntity } from "@/types/level";

/** A named thing a map can use, and how to spot it. */
export interface Mechanic {
  key: string;
  /** What it is called in the editor. */
  label: string;
  /**
   * Headline mechanics are the ones a map can be ABOUT. Seasoning is the rest:
   * a circle obstacle is furniture, and holding it to a spread quota would be
   * meaningless.
   */
  headline: boolean;
  detect: (l: LevelConfig) => boolean;
}

const ents = (l: LevelConfig): LevelEntity[] => (l.entities ?? []) as LevelEntity[];
const anyEntity = (l: LevelConfig, f: (e: LevelEntity) => boolean) => ents(l).some(f);

/**
 * The catalogue.
 *
 * Order is display order: headline mechanics first, roughly in the order the
 * ladder introduces them, then the furniture.
 */
export const MECHANICS: Mechanic[] = [
  { key: "mover", label: "Mover", headline: true, detect: l => anyEntity(l, e => e.kind === "mover") },
  { key: "breakable", label: "Breakable", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.breakable && !e.chest) },
  { key: "chest", label: "Chest", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.chest) },
  { key: "reveals", label: "Reveals", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.reveals) },
  { key: "mirror", label: "Mirror", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.mirror) },
  { key: "phasing", label: "Phasing", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.isPhasing) },
  { key: "bend", label: "Bent shape", headline: true, detect: l => anyEntity(l, e => !!e.bend || !!e.curves?.some(c => !!c)) },
  { key: "oneWay", label: "One-way", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.oneWay) },
  { key: "gate", label: "Ball gate", headline: true, detect: l => anyEntity(l, e => e.kind === "wall" && !!e.passTypes?.length) },
  { key: "fenceGround", label: "Fence ground", headline: true, detect: l => !!l.fenceZones?.length },
  { key: "gravityWell", label: "Gravity well", headline: true, detect: l => !!l.gravityWells?.length },
  { key: "coloredArea", label: "Colored area", headline: true, detect: l => !!l.coloredAreas?.length },
  { key: "circuit", label: "Terminals", headline: true, detect: l => !!l.circuit },
  { key: "charge", label: "Charge", headline: true, detect: l => !!l.charges?.length },
  { key: "dataStream", label: "Data stream", headline: true, detect: l => !!l.dataStream },
  { key: "threadLock", label: "Thread lock", headline: true, detect: l => !!l.threadLockRequired },
  { key: "fenceBudget", label: "WIP limit", headline: true, detect: l => !!l.fenceBudget },
  { key: "mutator", label: "Pinned mutator", headline: true, detect: l => !!l.mutator },
  { key: "pickupSpots", label: "Pickup spots", headline: true, detect: l => !!l.pickupSpots?.length },
  { key: "slots", label: "Slots", headline: false, detect: l => !!l.slots?.length },
  { key: "boss", label: "Boss", headline: false, detect: l => !!l.boss },
  { key: "polygon", label: "Polygon", headline: false, detect: l => anyEntity(l, e => e.shape === "polygon") },
  { key: "circle", label: "Circle", headline: false, detect: l => anyEntity(l, e => e.shape === "circle") },
];

/** The four acts, by level number. Bosses close each one. */
export const ACTS: { name: string; from: number; to: number }[] = [
  { name: "I Onboarding", from: 1, to: 10 },
  { name: "II The Sprint", from: 11, to: 20 },
  { name: "III Legacy Code", from: 21, to: 30 },
  { name: "IV Crunch", from: 31, to: 35 },
];

export interface MechanicUse {
  key: string;
  label: string;
  headline: boolean;
  /** Level numbers using it, ascending. */
  levels: number[];
  /** Count per act, parallel to ACTS. */
  perAct: number[];
}

/** Which maps use what. */
export function mechanicSpread(levels: LevelConfig[]): MechanicUse[] {
  return MECHANICS.map(m => {
    const used = levels.filter(m.detect).map(l => l.level).sort((a, b) => a - b);
    return {
      key: m.key,
      label: m.label,
      headline: m.headline,
      levels: used,
      perAct: ACTS.map(a => used.filter(n => n >= a.from && n <= a.to).length),
    };
  });
}

/** The act a level number belongs to, or null if it sits outside the ladder. */
export function actOf(levelNumber: number): string | null {
  return ACTS.find(a => levelNumber >= a.from && levelNumber <= a.to)?.name ?? null;
}

/**
 * Mechanics a headline idea is expected to reach, ladder-wide.
 *
 * Deliberately low. This is a floor that catches "introduced once and never
 * developed", not a target: a mechanic on two maps has at least been used
 * twice, which is the difference between a mechanic and a curiosity. Raising
 * it is a design decision, and the lint test is where that argument should
 * happen.
 */
export const MIN_HEADLINE_MAPS = 2;

export interface SpreadWarning {
  key: string;
  label: string;
  kind: "single-use" | "unused" | "act-monopoly";
  detail: string;
}

/**
 * What is wrong with the spread as it stands.
 *
 * Three complaints, and each says something different:
 *
 *  - UNUSED: authored, supported by the engine, and on no map at all. Dead
 *    weight that will rot.
 *  - SINGLE-USE: on exactly one map. It was introduced and then dropped, which
 *    is the specific failure this whole module exists to make visible.
 *  - ACT-MONOPOLY: one mechanic on more than half an act's maps. That is what
 *    "act III is all movers" looks like from the outside, and it is a
 *    complaint about monotony rather than about the mechanic.
 */
export function spreadWarnings(levels: LevelConfig[]): SpreadWarning[] {
  const spread = mechanicSpread(levels);
  const out: SpreadWarning[] = [];
  for (const m of spread) {
    if (!m.headline) continue;
    if (m.levels.length === 0) {
      out.push({ key: m.key, label: m.label, kind: "unused", detail: "on no map at all" });
    } else if (m.levels.length < MIN_HEADLINE_MAPS) {
      out.push({
        key: m.key, label: m.label, kind: "single-use",
        detail: `only on level ${m.levels[0]}, so it is introduced and never developed`,
      });
    }
  }
  for (const m of spread) {
    // Headline only, same as above. Circles are on 21 of 35 maps and that is
    // not a finding: furniture is supposed to be everywhere, and reporting it
    // buries the complaints that mean something under ones nobody will act on.
    if (!m.headline) continue;
    m.perAct.forEach((count, i) => {
      const act = ACTS[i];
      const size = levels.filter(l => l.level >= act.from && l.level <= act.to).length;
      if (size >= 4 && count > size / 2) {
        out.push({
          key: m.key, label: m.label, kind: "act-monopoly",
          detail: `on ${count} of act ${act.name.split(" ")[0]}'s ${size} maps`,
        });
      }
    });
  }
  return out;
}
