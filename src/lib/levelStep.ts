/**
 * The level index one step away, wrapping at both ends.
 *
 * Split out because the backwards case has a real trap in it: JavaScript's `%`
 * keeps the sign of the dividend, so the obvious `(idx - 1) % length` returns
 * -1 at the first level and indexes `undefined`, which lands as a blank board
 * rather than as an error anyone could read.
 *
 * `current` is -1 when no level is loaded yet. Forwards from there opens the
 * first level and backwards opens the LAST, which is the useful mirror: the
 * back button is most often wanted for the end of the ladder.
 */
export function stepLevelIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return 0;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return ((current + delta) % length + length) % length;
}
