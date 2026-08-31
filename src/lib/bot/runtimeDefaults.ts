import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

/**
 * The runtime fields GameCanvas seeds before initGame's data is merged over it.
 *
 * Lifted from GameCanvas's own gameRef literal rather than retyped, because a
 * hand-copied second list is a list that drifts - and a missing field here does
 * not fail loudly, it makes the bot crash three hundred frames in on something
 * that has nothing to do with the bug it was hunting.
 *
 * Props-dependent fields (the mutator, gravity, the objective, the creep
 * config) are dropped: the harness supplies those itself.
 *
 * ── A FUNCTION, not a constant ─────────────────────────────────────────────
 *
 * This was a module-level object literal, and createBotGame spread it. A spread
 * is shallow, so every bot game in a process shared the SAME arrays - and the
 * ones initGame does not return, `activeWalls` above all, were never replaced.
 * A run that ended with a fence still growing left that fence in the array for
 * the NEXT run to inherit, which then stepped two walls per frame and completed
 * its cut in a single frame.
 *
 * It hid for a long time because the tests that use the bot mostly run maps to
 * completion, and a completed fence removes itself. It surfaced the moment two
 * short runs were compared against each other - which is exactly what the map
 * builder's playtest button does, twelve times in a row.
 */
export function runtimeDefaults() {
  return {
    spaceGrid: null,
    gridRegions: [],
    regions: [],
    walls: [],
    obstaclePolygons: [],
    mirrorPolygons: [],
    boardPolygon: null,
    originalArea: 0,
    basePlayableArea: 0,
    balls: [],
    movers: [],
    activeWalls: [],
    gameOver: false,
    levelComplete: false,
    paused: false,
    swipeStart: null,
    swipeRegionId: null,
    currentSwipePos: null,
    swipePointerId: null,
    swipeTrail: null,
    lastTime: 0,
    accumulator: 0,
    animationId: 0,
    lastAutoFreezeAt: 0,
    activePlaySeconds: 0,
    clearedActiveSeconds: null,
    creepFactor: 1,
    lastCreepPct: -1,
    // Normalised once per map rather than per frame; a malformed authored block
    // yields null, which simply disables gravity instead of half-applying it.
    bossFiredPhases: [],
    firedBeats: [],
    warnedBeats: [],
    pendingBeats: [],
    beatSpeedMult: 1,
    coloredAreas: [],
    coloredAreaSatisfied: false,
    circuit: null,
    charges: [],
    dataStream: null,
    bossActive: false,
    bossHp: 0,
    bossMaxHp: 0,
    bossDefeated: false,
    bossMinionCount: 0,
    chains: [],
    phasingObjects: [],
    screenSize: { width: 0, height: 0 },
    boardRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 },
    backgroundColor: "#0a1a10",
    regionColor: "#1a3020",
    wallCount: 0,
    completedCuts: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null,
    pushMode: "none",
    pushPromptPending: false,
    bestRemainingPercent: 100,
    pushStartPercent: 100,
    levelClearedTime: 0,
    shimmerStart: 0,
    shimmerFrozen: false,
    isRecovering: false,
    recoveryEndTime: 0,
    initialSamplePoints: [],
    frozenBallId: null,
    frozenBallReleaseAt: null,
    frozenBallVelocity: null,
    frozenBallPosition: null,
    lockedBallsCount: 0,
    mapBasePoints: 20,
    lockBonus: 0,
    lockDeliveryBonus: 0,
    coloredAreaTargets: 0,
    lockedByType: {},
    superiorLockCount: 0,
    superiorLockBonus: 0,
    breakablesSmashed: 0,
    zoneLockCount: 0,
    zoneLockBonus: 0,
    moneyMultiplier: 1,
    ballSpeedScale: 1,
    assimilations: new Map(),
    dissolve: null,
    bonusCutCells: new Set<string>(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockBaseThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockMinRegionCells: 0,
    fenceDurability: null,
    pendingWallBreaks: [],
    destructibles: [],
    pendingDestroys: [],
    objectDebris: [],
    stackObjects: [],
    fallingObjects: [],
    objectivesTotal: 0,
    objectivesBroken: 0,
    breakBonus: 0,
    breakMultiplier: 1,
    lastDudAt: 0,
    chestLoot: [],
    chestRewardsLog: [],
    claimFlashes: [],
    slowAreas: [],
    abilitySlowUntil: 0,
    abilitySlowMult: 1,
    abilityFenceRushUntil: 0,
    abilityFenceRushMult: 1,
    abilityFenceShieldUntil: 0,
    abilityFx: [],
    pickups: [],
    pickupConfig: null,
    pickupSpots: [],
    obstacleRules: new Map(),
    fenceZones: [],
    lastPickupRollAt: 0,
    pickupRollContext: 'pickups',
    pickupRollIndex: 0,
    pickupOvertime: 0,
    pickupCapBonus: 0,
    freezeCharges: 0,
    freezeChargeSeconds: 0,
    freeShopItems: 0,
    pickupsClaimedLog: [],
    freezeUsesRemaining: 0,
    freezePickups: false,
    pickupFeedback: [],
  };
}
