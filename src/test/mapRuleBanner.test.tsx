/**
 * The strip that says this map is not playing by normal rules.
 *
 * A mutator changes how a whole map behaves. Technical Gravity bends every path
 * on the board and was reported three times as a malfunction, because its name
 * lived only inside the collapsed Specs panel.
 *
 * The first attempt put a chip in the top bar's stats row, and that was
 * reported straight back: "the technical gravity sign isn't working up there,
 * it has to be clearer, like a warning sign." It was competing with six numbers
 * the player reads constantly, at the same size and weight as all of them. A
 * rule that changes the physics is not a stat, and rendering it as one is what
 * made it disappear.
 *
 * The second attempt gave it its own full-width strip between the top bar and
 * the board, and that came back as "too big and you can't see all of it". Both
 * halves are true and they have one cause: the strip did TWO jobs on one line.
 * The name was black letterspaced caps marked flex-shrink-0, so on a 393px
 * phone it took the whole row and truncated the description to "Everything is
 * pulled ..." - the clause that actually stops bent trajectories reading as a
 * bug. Too tall to spare AND too narrow to finish its sentence is not a size
 * problem, it is two things in one place.
 *
 * So the strip is two STATES in one place: it announces the rule in full for a
 * few seconds in the empty band above the board, then collapses to a compact
 * hazard chip that persists. Noticing and remembering are different jobs and
 * they get different sizes.
 *
 * What the banner says, and its two states, are checked in
 * canvas/MapRuleBanner.test.ts; this file keeps where it sits and what feeds it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('where it sits', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('is placed from the board top edge, not pinned under the bar', () => {
    // Centred in the GUTTER: the board is square in a taller frame, so how much
    // space sits above it depends on the surface and only GameCanvas can
    // measure it. The banner is given the gap above the board as its box and
    // centres itself in it, which is the middle of that gap.
    const src = read('src/components/game/GameScreen.tsx');
    const i = src.indexOf('<MapRuleBanner');
    expect(i, 'the banner is never rendered').toBeGreaterThan(-1);
    const block = src.slice(i, i + 500);
    expect(block, 'the banner does not use the measured gutter').toContain('(r.height * boardTopPct) / 100');
    const banner = read('src/ui/game/MapRuleBanner.tsx');
    expect(banner, 'the banner is not centred in the box it is given')
      .toContain('<View layout={{ alignItems: "center", justifyContent: "center", ...(layout ?? {}) }}>');
  });

  it('is measured, not guessed', () => {
    // GameCanvas has to actually report the edge, or the placement above is
    // reading a number that never changes.
    const screen_ = read('src/components/game/GameScreen.tsx');
    expect(screen_, 'GameScreen never asks for the board edge').toContain('onBoardTopPct={handleBoardTopPct}');
    const canvas = read('src/components/game/GameCanvas.tsx');
    expect(canvas, 'GameCanvas never reports the board edge').toContain('onBoardTopPctRef.current?.(');
  });

  it('cannot swallow a cut aimed near the top of the board', () => {
    // It floats over the play surface, so the box it fills must be inert (a
    // plain View takes no touches, ui/kit); only the banner itself is pressed.
    const banner = read('src/ui/game/MapRuleBanner.tsx');
    const body = banner.slice(banner.indexOf('\n  return (\n'));
    expect(body.trimStart().startsWith('return (\n    <View'), 'the floating box eats pointer events').toBe(true);
    expect(body, 'the banner itself cannot be pressed').toContain('<Pressable onTap={onExplain}');
  });

  it('is given the map mutator to state', () => {
    // The prop is optional, so a screen that stopped passing it would make the
    // banner silently vanish with nothing else failing.
    const src = read('src/components/game/GameScreen.tsx');
    const i = src.indexOf('<MapRuleBanner');
    expect(src.slice(i, i + 200)).toContain('mutator={mapMutator}');
  });

  it('no longer duplicates itself as a chip in the stats row', () => {
    // Two weak indicators for one thing is worse than one clear one, and the
    // chip was the one that did not work.
    const bar = read('src/ui/game/GameTopBar.tsx');
    expect(bar, 'the top bar still renders a mutator chip').not.toContain('mapMutator');
  });
});
