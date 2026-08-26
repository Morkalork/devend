/**
 * Assignment pool loading + drawing (issue #60; see src/types/assignment.ts).
 *
 * A module-level catalogue loaded from public/assignments.yml, with graceful
 * fallback to an empty pool: no assignments makes assignment levels fall back to
 * the regular shop, so a broken file never gates play. The file keeps its
 * `doorDraft` name and `getDoors`/`drawDoorOffers` exports because the run
 * session still threads the pick as the internal `activeDoor`.
 */
import {
  AssignmentConfig,
  AssignmentConditionKind,
  AssignmentReward,
  AssignmentTier,
  AssignmentTrack,
} from '@/types/assignment';
import { UpgradeTier } from '@/types/upgrade';
import { fetchYamlCatalogue, parseModifiers, drawRandom } from '@/lib/yamlCatalogue';

/** Assignments rolled per draft; the pick is 1-of-3, or skip. */
export const ASSIGNMENT_OFFER_COUNT = 3;

/** Default assignment cadence: one every N completed levels. */
export const DEFAULT_DOOR_LEVEL = 5;

/**
 * The condition kinds the parser accepts. Exported because an entry whose kind
 * is not in here is DROPPED silently - a typo removes an assignment from the
 * game and nothing says so - and the pool test guards the YAML against this
 * set rather than keeping a second copy of it to drift from.
 */
export const CONDITION_KINDS = new Set<AssignmentConditionKind>([
  'lockCount', 'superiorLocks', 'underPar', 'speedClear', 'allBallsLocked', 'ballType',
  'noLocks', 'smashCount',
]);
const TIERS = new Set<UpgradeTier>(['Junior', 'Senior', 'Principal', 'Architect', 'Wizard']);

let liveAssignments: AssignmentConfig[] = [];
let liveTriggerLevel = DEFAULT_DOOR_LEVEL;

export function getDoors(): AssignmentConfig[] {
  return liveAssignments;
}

/** Assignment cadence N (assignments.yml offeredAfterLevel): one every N levels. */
export function getDoorTriggerLevel(): number {
  return liveTriggerLevel;
}

/**
 * Assignments replace the shop on every Nth completed level (5, 10, 15, ...
 * with the default cadence). The accepted assignment's constraint + mission then
 * run until the next assignment swaps it out.
 */
export function isAssignmentLevel(completedLevel: number): boolean {
  const n = getDoorTriggerLevel();
  return n > 0 && completedLevel > 0 && completedLevel % n === 0;
}

function parseParams(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseReward(raw: unknown): AssignmentReward | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'lives': {
      const count = Number(r.count);
      return Number.isFinite(count) && count > 0 ? { type: 'lives', count: Math.round(count) } : null;
    }
    case 'overtime': {
      const hours = Number(r.hours);
      return Number.isFinite(hours) && hours > 0 ? { type: 'overtime', hours: Math.round(hours) } : null;
    }
    case 'modifiers': {
      const modifiers = parseModifiers(r.modifiers);
      if (!modifiers || typeof r.blessing !== 'string') return null;
      const scope = r.scope === 'block' ? 'block' : 'run';
      return {
        type: 'modifiers',
        blessing: r.blessing,
        modifiers,
        scope,
        requiresUpgradeId: typeof r.requiresUpgradeId === 'string' ? r.requiresUpgradeId : undefined,
      };
    }
    case 'tierDraft': {
      return typeof r.tier === 'string' && TIERS.has(r.tier as UpgradeTier)
        ? { type: 'tierDraft', tier: r.tier as UpgradeTier }
        : null;
    }
    default:
      return null;
  }
}

function parseTrack(raw: unknown): AssignmentTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !CONDITION_KINDS.has(r.kind as AssignmentConditionKind)) return null;
  const kind = r.kind as AssignmentConditionKind;
  const params = parseParams(r.params);
  // A `ballType` bounty is normally authored WITHOUT a type: the right one
  // depends on which maps the block turns out to contain, so it is named at
  // draft time (assignmentScaling.resolveBountyForBlock). An explicit one is
  // honoured, which is what makes a bounty testable and pinnable in a Daily.
  const ballType = typeof r.ballType === 'string' && r.ballType ? r.ballType : undefined;
  if (r.mode === 'everyMap') {
    const minMaps = Number(r.minMaps);
    return { mode: 'everyMap', kind, params, ballType, minMaps: Number.isFinite(minMaps) ? Math.round(minMaps) : undefined };
  }
  if (r.mode === 'cumulative') return { mode: 'cumulative', kind, params, ballType };
  return null;
}

function parseTier(raw: unknown): AssignmentTier | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const threshold = Number(r.threshold);
  const reward = parseReward(r.reward);
  if (!Number.isFinite(threshold) || threshold <= 0 || typeof r.label !== 'string' || !reward) return null;
  return { threshold: Math.round(threshold), label: r.label, reward };
}

/** Coerce one raw YAML entry into an AssignmentConfig, or null if unusable. */
function parseAssignmentEntry(raw: unknown): AssignmentConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;

  const mission = r.mission as Record<string, unknown> | undefined;
  if (!mission || typeof mission.text !== 'string') return null;
  const track = parseTrack(mission.track);
  if (!track) return null;
  const tiersRaw = Array.isArray(mission.tiers) ? mission.tiers : [];
  const tiers = tiersRaw.map(parseTier).filter((t): t is AssignmentTier => t !== null)
    .sort((a, b) => a.threshold - b.threshold);
  if (tiers.length === 0) return null;

  let constraint: AssignmentConfig['constraint'];
  const c = r.constraint as Record<string, unknown> | undefined;
  if (c && typeof c.text === 'string') {
    constraint = {
      text: c.text,
      modifiers: parseModifiers(c.modifiers) ?? undefined,
      disablePushYourLuck: c.disablePushYourLuck === true,
    };
  }

  return {
    id: r.id,
    name: r.name,
    constraint,
    mission: { text: mission.text, track, tiers },
    clarify: typeof r.clarify === 'string' ? r.clarify : undefined,
  };
}

/**
 * Load the assignment pool from public/assignments.yml. Returns true on success;
 * failure keeps the previous pool (initially empty) so a broken file never gates
 * play.
 */
export async function loadDoors(): Promise<boolean> {
  try {
    const { entries, doc } = await fetchYamlCatalogue('/assignments.yml', 'assignments', parseAssignmentEntry);
    liveAssignments = entries;
    const trigger = Number(doc.offeredAfterLevel);
    liveTriggerLevel = Number.isFinite(trigger) && trigger > 0 ? Math.round(trigger) : DEFAULT_DOOR_LEVEL;
    return true;
  } catch (err) {
    console.warn('[assignments] pool unavailable, playing without assignments:', err);
    return false;
  }
}

/** Draw `n` distinct assignments from the pool (uniform, no replacement). */
export function drawDoorOffers(pool: AssignmentConfig[], n: number, rng?: () => number): AssignmentConfig[] {
  return drawRandom(pool, n, rng);
}
