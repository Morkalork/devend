/**
 * How a timed map shows its clock on the board itself.
 *
 * The countdown used to be a 6px bar under the fence slots, sharing its row
 * with the refusal message, so it was the furthest thing on a phone from where
 * the player looks and it vanished whenever a cut was refused. Reported as
 * "easy to miss". The board's own frame now drains as the clock does (see
 * DeadlineFrame), and a couple of milestone seconds flash over the board on
 * the way down, ahead of BoardAlert's final-ten-seconds alarm.
 *
 * Pure, so the geometry and the milestones are testable without a DOM.
 */

/** Seconds left at which the board flashes the number, once each. */
export const DEADLINE_MILESTONES: readonly number[] = [30, 20];

/** Green (full) -> amber -> red (empty), by the share of time left. */
export function deadlineColor(remaining: number): string {
  const hue = Math.max(0, Math.min(120, 120 * remaining)); // 120 green .. 0 red
  return `hsl(${hue}, 85%, 52%)`;
}

/**
 * The milestone this second is, or null. A milestone only counts on a map
 * whose limit is longer than it, so a 30s map does not open by flashing 30.
 */
export function deadlineMilestone(secondsLeft: number, limit: number): number | null {
  if (DEADLINE_MILESTONES.includes(secondsLeft) && limit > secondsLeft) {
    return secondsLeft;
  }
  return null;
}

/**
 * A rectangle traced clockwise from the middle of its top edge, so a stroke
 * dashed to a share of its length drains like a clock hand sweeping back to
 * twelve. Coordinates are the centre line of the band.
 */
export function clockRectPath(x: number, y: number, w: number, h: number): { d: string; length: number } {
  const cx = x + w / 2;
  const d = `M ${cx} ${y} H ${x + w} V ${y + h} H ${x} V ${y} H ${cx}`;
  return { d, length: 2 * (w + h) };
}
