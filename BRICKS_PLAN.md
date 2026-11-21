# BRICKS_PLAN.md

The brick pivot: breaking bricks moves to the centre of the game. Status:
**started** (the ladder is restarted, two maps in).

## Why

The card work (CARDS_PLAN.md, UPGRADE_SWEEP_REPORT.md) showed that a card is
felt when it changes something visible and countable, and bricks are both. A
ladder built around breaking gives cards three things to change: the tools,
the fences, and the bricks themselves.

The direction, as the owner set it:

- **Most maps revolve around breaking bricks**, on the win system the game
  already has. Locking balls, areas and sides all stay; new goals join them:
  clear the whole map, clear enough to reach an item.
- **Locking the board down is how bricks get broken.** A fence takes empty
  board away, so the balls come back to the bricks sooner.
- **The fence is the first tool, not the only one.** The next is pinch, draw
  and fire a ball (today the Redeploy fence's slingshot): lock the map down,
  then fire for speed, because damage grows faster than speed
  (`DAMAGE_EXP` in `src/lib/physics/destructibles.ts`). More tools and more
  fence types follow.
- **Tools and cards are separate layers.** A tool is something a finger does
  and it stays for the run; a card changes how a tool, a fence or a brick
  behaves.

## The ladder was started over

| File | What it is |
|---|---|
| `public/map.yml` | The new ladder, built one map at a time. What a run plays. |
| `public/maps-archive.yml` | The 45 maps from before the pivot, unchanged. Not played in a run. |

The archive is served, so **Admin > Playground > the level picker** lists it
under "Archive", below the ladder. An archived map opens and plays like any
other, and can be edited and restarted in memory, but is never saved: the two
files reuse ids (both have a `level-1`), and a save would write the old map
over the new one. The Level button says "Archive" while one is open.

Tests: `ARCHIVE` in `src/test/fixtures/maps.ts` is the old ladder, and the
engine's tests run on it (`ENGINE_MAPS` is the archive plus the older retired
maps). `LADDER` is the new one. Session tests that need a long run read the
archive as their ladder.

While the ladder is this short, a run is this short: it ends after the last
map. Everything keyed to a map number waits for the ladder to reach it
(Sprint Planning at 3, contracts at 4, bosses at 10, most cards' unlock
levels). A run saved on the old ladder resumes on the new one, clamped to its
last map.

## The maps

**1. Hello World.** The old first map, kept exactly: one ball, one doorway,
the corner nook that ends the map early.

**2. Unit Tests.** Nine one-touch bricks in a 3x3 block in the middle of an
open board, two balls, thirty seconds. The win is all nine bricks and nothing
else; space is not asked for. The clock is authored, so it runs although map 2
is in the band that has no default clock (`getMapTimeLimit` now honours an
authored `timeLimit` on any map).

Measured with the headless bot, 16 seeds, 30 seconds each:

| Play | Cleared | Notes |
|---|---|---|
| No fences at all | 0 of 16 | 3 to 8 of the 9 bricks broken when the clock ran out |
| The bot's own plain fences | 4 of 16 | wins at 13, 14, 17 and 24 seconds; one loss to locking both balls away from the bricks |
| No fences, board shrunk to 60% of its area | 5 of 12 | most of the rest stopped at 8 of 9 |

So the lesson holds (the open board never gets there, fencing does), and the
map is **hard**: the centre brick is the bottleneck, since nothing reaches it
until a neighbour has gone. The bot does not aim its fences at the bricks, so
a player should do better than 4 in 16, but running out of time loses the map
whatever lives remain. If it plays too hard: ask for 8 of the 9 (the design
card's "every counted clause has a spare"), or give it 40 seconds.

## Open

- Whether "cut the board down to X%" stays a goal on most maps or steps back.
- The slingshot as a standing tool, and where on the ladder it arrives.
- Brick types (armoured, explosive, regenerating) and the cards for them.
- Scoring: breaking as a main source of pay, not a side bonus.
