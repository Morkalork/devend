/**
 * Rubble: the pieces a breakable sheds on its way to breaking, and they are
 * real enough to hit.
 *
 * Every other bit of feedback a struck slab gives is a picture. Chips spray and
 * fade, the border bites inward, the rim dulls - none of it touches a ball, so
 * a slab three hits from death changes nothing about the board except how it
 * looks. Reported from play as wanting "pieces of it falling off and being
 * hittable by balls to change their course", which is the rest of that idea:
 * material that leaves a slab should still be somewhere.
 *
 * ── What a chunk is, and what it deliberately is not ───────────────────────
 *
 * A chunk is a TRANSIENT DEFLECTOR. It is a small disc that slides away from
 * the face it was knocked off, slows, comes to rest, and fades. A ball that
 * meets one bounces off it specularly - the same reflection a wall gives, with
 * no gain - and knocks it further across the board.
 *
 * It is NOT a wall. It never enters `game.walls`, never rasterises into the
 * space grid, never splits a region, and is never an occluder for reachability.
 * That is the whole reason this is a safe thing to add: the win conditions, the
 * lock rules, the stranding checks and the bot's model of the board all carry
 * on seeing exactly the board they saw before. A piece of rubble can change
 * where a ball GOES; it can never change what the map WANTS, or seal anything,
 * or make a pocket uncapturable.
 *
 * ── Why it fades rather than lasting the map ───────────────────────────────
 *
 * A slab with five hits in it would otherwise leave a permanent field of
 * deflectors around itself, and a board that accumulates unplanned obstacles
 * for the whole level stops being the board the player read at the start. A few
 * seconds is long enough to change the rally that knocked it loose, which is
 * the effect that was asked for, and short enough that the map is still the map.
 */
import type { Ball, RubbleChunk } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";

/** World units a chunk can be across. Small: this is a flake, not a boulder. */
export const CHUNK_MIN_RADIUS = 5;
export const CHUNK_MAX_RADIUS = 9;

/** How long a chunk lives before it has finished fading, in ms. */
export const CHUNK_LIFE_MS = 6000;

/** Fraction of its life a chunk spends fading out at the end. */
export const CHUNK_FADE = 0.3;

/**
 * Speed lost per second while sliding, as a survival fraction.
 *
 * Chunks are the one thing on this board that slow down. Balls never do - the
 * launcher's wager depends on that - but a chip skittering across the floor
 * and stopping is what makes it read as debris rather than as another ball.
 */
export const CHUNK_DRAG = 0.12;

/** Below this it has stopped, and stops being integrated at all. */
const CHUNK_REST_SPEED = 4;

/**
 * Most chunks on the board at once.
 *
 * A demolition map can have a dozen slabs taking hits at the same time, and
 * past a handful of loose pieces nobody can tell which came from where. The
 * oldest goes first, so the newest hit always produces something visible.
 */
export const MAX_RUBBLE = 20;

/** One contact is one deflection, however many frames the overlap lasts. */
const DEFLECT_COOLDOWN_MS = 90;

/**
 * Knock `count` pieces off a face.
 *
 * `ax, ay` is the outward unit direction (slab centre through the impact), the
 * same vector the chip burst is sprayed along, so the rubble and the chips come
 * off the same side of the same slab and read as one event.
 *
 * Seeded from the caller's rng rather than Math.random so a replayed seed
 * produces the same board: a deflector is physics, and physics that differs
 * between two runs of one seed would put the bot and the player on different
 * boards.
 */
export function spawnRubble(
  game: CanvasGameState,
  impact: { x: number; y: number },
  ax: number,
  ay: number,
  color: string,
  now: number,
  rng: () => number,
  count = 1,
): void {
  game.rubble ??= [];
  for (let i = 0; i < count; i++) {
    // A cone around the outward normal, so pieces leave the face rather than
    // along it, with enough spread that two chunks off one hit separate.
    const angle = Math.atan2(ay, ax) + (rng() - 0.5) * 1.5;
    const speed = 90 + rng() * 150;
    const radius = CHUNK_MIN_RADIUS + rng() * (CHUNK_MAX_RADIUS - CHUNK_MIN_RADIUS);
    game.rubble.push({
      id: `rubble-${now.toFixed(0)}-${i}-${game.rubble.length}`,
      // Born just clear of the face, or the first integration step can leave it
      // overlapping the slab it came off.
      x: impact.x + Math.cos(angle) * (radius + 2),
      y: impact.y + Math.sin(angle) * (radius + 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      rotation: rng() * Math.PI * 2,
      rotSpeed: (rng() - 0.5) * 9,
      bornAt: now,
      lifeMs: CHUNK_LIFE_MS,
      color,
    });
    if (game.rubble.length > MAX_RUBBLE) game.rubble.shift();
  }
}

/** Alpha for a chunk at `now`: solid, then fading over its last CHUNK_FADE. */
export function rubbleAlpha(chunk: RubbleChunk, now: number): number {
  const t = (now - chunk.bornAt) / chunk.lifeMs;
  if (t <= 1 - CHUNK_FADE) return 1;
  return Math.max(0, (1 - t) / CHUNK_FADE);
}

/**
 * Slide every chunk, and drop the ones that have finished fading.
 *
 * Board bounds only, and no wall collision: a chunk is a flake skittering over
 * a flat board, and giving it the full obstacle pass would cost what a ball
 * costs for something that is decoration with a hitbox. It stops on its own
 * long before it has travelled far enough for the difference to read.
 */
export function updateRubble(game: CanvasGameState, dt: number, now: number): void {
  const list = game.rubble;
  if (!list || list.length === 0) return;

  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (now - c.bornAt >= c.lifeMs) continue;   // faded: dropped by not keeping it

    const speed = Math.hypot(c.vx, c.vy);
    if (speed > CHUNK_REST_SPEED) {
      const keep = Math.pow(CHUNK_DRAG, dt);
      c.vx *= keep;
      c.vy *= keep;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rotation += c.rotSpeed * dt;
      c.rotSpeed *= keep;
    } else if (speed > 0) {
      c.vx = 0;
      c.vy = 0;
      c.rotSpeed = 0;
    }
    list[write++] = c;
  }
  list.length = write;
}

/**
 * Bounce `ball` off any chunk it is touching, and shove the chunk away.
 *
 * Specular, magnitude-preserving, exactly like a wall: nothing on this board
 * damps a ball (see the launcher's note on why its wager depends on that), and
 * a deflector that quietly bled speed would be a brake wearing a rock's paint.
 * What the ball loses is its heading, which is the whole point.
 *
 * The chunk takes the shove, because a piece of rubble that a ball passes
 * through unmoved reads as painted on. It is not a momentum exchange - the ball
 * keeps its speed - which is a cheat, and the honest justification is that a
 * slab's flake weighs nothing beside a ball and the alternative costs the ball
 * the speed the map was priced at.
 */
export function deflectOffRubble(game: CanvasGameState, ball: Ball, now: number): void {
  const list = game.rubble;
  if (!list || list.length === 0) return;
  if (ball.state === "won" || ball.state === "dormant") return;

  for (const c of list) {
    // One contact is one deflection: without this the ball is turned again on
    // every frame it overlaps, which walks it along the chunk's edge instead
    // of sending it away.
    if (c.lastBallId === ball.id && now - (c.lastHitAt ?? 0) < DEFLECT_COOLDOWN_MS) continue;

    const dx = ball.position.x - c.x;
    const dy = ball.position.y - c.y;
    const reach = ball.radius * (ball.assimScale ?? 1) + c.radius;
    const dist = Math.hypot(dx, dy);
    if (dist >= reach || dist < 1e-6) continue;

    const nx = dx / dist, ny = dy / dist;
    const vn = ball.velocity.x * nx + ball.velocity.y * ny;
    // Only a ball moving INTO the chunk is turned. One already leaving it is
    // on its way out of an overlap the cooldown has not cleared yet, and
    // reflecting it again would trap it against the chunk.
    if (vn < 0) {
      ball.velocity = {
        x: ball.velocity.x - 2 * vn * nx,
        y: ball.velocity.y - 2 * vn * ny,
      };
      ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    }
    // Out of the overlap, so the next frame starts clear rather than resolving
    // the same contact again from the inside.
    ball.position = { x: c.x + nx * reach, y: c.y + ny * reach };

    const kick = Math.min(320, ball.speed * 0.45);
    c.vx -= nx * kick;
    c.vy -= ny * kick;
    // Spin from the GLANCE, not from a dice roll: the tangential part of the
    // ball's approach is what would actually set a flake turning, and a random
    // one here would make a replayed seed diverge on a collision the bot and
    // the player are both meant to see the same way.
    c.rotSpeed += (ball.velocity.x * -ny + ball.velocity.y * nx) / Math.max(1, c.radius) * 0.35;
    c.lastBallId = ball.id;
    c.lastHitAt = now;
  }
}
