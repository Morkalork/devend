/**
 * Rainbow spawner — the rainbow ball's timed spit-out.
 *
 * Every `spawnIntervalSeconds` of ACTIVE-PLAY time (game.activePlaySeconds, so
 * pauses/holds/recovery never advance it), each active rainbow ball spawns one
 * random ball type eligible for the current level, EXCLUDING rainbow types
 * (getSpawnableBallTypes) so the count stays linear, never exponential. Locking
 * (trapping) a rainbow ball stops it — only `state === 'active'` balls spit.
 *
 * Runs once per frame OUTSIDE the ball-iteration loop, because it appends to
 * game.balls (the Fork pickup has the same constraint). The map's hard time
 * limit is the pressure that keeps the pile-up in check.
 */
import { CanvasGameState } from '@/types/gameState';
import { getBallType, getSpawnableBallTypes, DEFAULT_RAINBOW_SPAWN_INTERVAL } from '@/lib/ballTypes';
import { createBall } from '@/lib/initGame';
import { MAX_LIVE_BALLS } from '@/lib/gameConstants';
import { spawnClearOfParent } from '@/lib/physics/spawnPlacement';
import { runStream } from "@/lib/runRng";

let _rainbowCounter = 0;

// Defensive cap on catch-up spawns in a single frame; the active-play clock
// advances smoothly so this is only ever hit by a pathological dt.
const MAX_CATCHUP_SPAWNS = 4;

/**
 * Advance every rainbow ball's spawn timer for one frame.
 *
 * @param game        live game state (game.balls is mutated).
 * @param levelNumber current logical level, for eligibility of the spit-out.
 */
export function tickRainbowSpawns(game: CanvasGameState, levelNumber: number): void {
  // Cheap pre-check so the common case (no rainbow ball, i.e. almost every map)
  // costs one scan and ZERO allocation - this runs every frame.
  let anyRainbow = false;
  for (const b of game.balls) {
    if (b.ability === 'rainbow' && b.state === 'active' && b.speed > 0) { anyRainbow = true; break; }
  }
  if (!anyRainbow) return;

  // Snapshot the rainbows: never iterate balls we may append this frame.
  const rainbows = game.balls.filter(b => b.ability === 'rainbow' && b.state === 'active' && b.speed > 0);

  const spawnable = getSpawnableBallTypes(levelNumber);
  if (spawnable.length === 0) return;

  for (const rb of rainbows) {
    if (game.balls.length >= MAX_LIVE_BALLS) break; // hard safety cap (memory + CPU)
    const rainbowType = getBallType(rb.typeId);
    const interval = rainbowType?.spawnIntervalSeconds ?? DEFAULT_RAINBOW_SPAWN_INTERVAL;
    const anchor = rb.spawnActiveSeconds ?? 0;
    const due = Math.floor((game.activePlaySeconds - anchor) / interval);
    const already = rb.rainbowSpawnCount ?? 0;
    if (due <= already) continue;

    // Derive the run's speed scaling from the rainbow ball itself, so spawned
    // balls match the current ball-speed/size modifiers without threading them.
    const speedScale = rainbowType && rainbowType.baseSpeed > 0 ? rb.baseSpeed / rainbowType.baseSpeed : 1;
    const toSpawn = Math.min(due - already, MAX_CATCHUP_SPAWNS);
    for (let k = 0; k < toSpawn; k++) {
      if (game.balls.length >= MAX_LIVE_BALLS) break; // hard safety cap
      // Seeded: a Daily Stand-up run must spit the same types in the same
      // order for every player. One persistent stream, not getRunRng, or
      // every spit would draw the same colour.
      const type = spawnable[Math.floor(runStream("rainbowSpit")() * spawnable.length)];
      // A clear gap from the parent, not the old sub-radius offset: a rainbow
      // child is the SAME size as its parent and its type is picked at random,
      // so being born on top of it read as the ball duplicating itself.
      const position = spawnClearOfParent(game, rb);
      const child = createBall(type, position, speedScale, rb.radius, `${type.id}-rainbow-${++_rainbowCounter}`, performance.now(), game.activePlaySeconds);
      child.regionId = rb.regionId; // born in the parent's region
      game.balls.push(child);
    }
    rb.rainbowSpawnCount = due;
  }
}
