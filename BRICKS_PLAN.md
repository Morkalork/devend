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

## The balls are the player's

Decided 2026-11-22 (BALL_TREE_PLAN.md, the upgrade tree that replaces the
cards): **a map brings no balls.** The player's roster of one to three balls
rolls onto every map, and `maxBalls` is a cap on it, never a floor. So every
map on this ladder, map 2 included, has to be clearable and fair with ONE
ball and the standard fence, from today; a map that needs two balls to reach
its bricks in time is a map that needs a smaller board, a longer clock or a
lower count. Tools (the slingshot among them) are bought from the tree, so
the ladder places a map where a tool is worth buying, never one that
requires it. Bricks pay hours as locks do, by the map's goal. A boss is the
board, never a ball. The ladder's cards go with the tree; tools and the
things a card changed about a tool become its nodes.

## Locks and bricks

Reported from play on map 2. The rule is about what is IN the pocket
(`brickHeldLock.test.ts`):

1. **A pocket with a standing brick in it does not lock**, whatever the win
   asks for (`regionHoldsStandingBrick`, asked by the brick's body: a cell
   touching it is in the pocket). The older rule only held while the win still
   owed bricks.
2. **Breaking can trigger the lock.** When the pocket's last brick goes and the
   pocket is lock-sized, it locks there and then, with no further fence
   (`settleBrickHeldLocksFn`, run after the frame's destroys; the lock pass was
   lifted out of the cut so both paths pay, capture and tint the same way).
3. **Any fence may be drawn.** No fence is turned away for the bricks. Both
   refusals that once did (one predicting the lock a fence would cause, and
   the older one for a fence leaving owed bricks out of reach) were taken out
   at the owner's word.
4. **Fencing bricks off with no ball beside them claims them, bricks and all.**
   If the bricks still in reach are enough for the win, the map goes on: on a
   map with bricks spread about, areas of them may be fenced away freely. If
   they are not enough, the map is lost there and then ("objective buried"),
   like any other requirement that can no longer be met
   (`brickBurial.test.ts`).
5. **Reach does not pass through a fence.** A brick counts as in reach only if
   a ball's open ground touches it with no player fence between
   (`canStillStrike`). Before, a ball in a sliver just across a fence from the
   block read as able to break it.
6. **The last ball stays free while bricks are owed.** A lock-sized pocket
   around the last moving ball does not lock while the win still needs bricks
   broken, so a brick map never ends "locked out" with bricks standing. If
   that ball cannot reach the bricks, rule 4 ends the map, and says bricks.
7. **A brick is never a wall.** Reported from play on map 2, twice over: a
   fence drawn at the block stopped at a brick as if it were a wall, and a
   room "shut" by a brick counted as sealed. Now a cut passes through a brick
   (`cuttableWalls`: the cut, its preview, the bot's look-ahead and the admin
   probe all cast past brittle walls), a brick is not sealed into the capture
   grid (the ground under it is one room with the ground beside it, so no
   fence can lean on it), and bricks fenced off with no ball beside them are
   buried with the ground (`buryClaimedBricks`: hidden, uncounted, out of
   reach, so rule 4 fires on them as before). Balls still bounce off bricks:
   it is the FENCE a brick is nothing to, not the ball. Breaking a brick
   rebuilds the sample regions even though it reopens no grid ground, or a
   ball rolling onto where it stood was "outside every region" and thrown
   back (`brickNeverAWall.test.ts`). Archive maps that used brick runs as
   partitions (7, 17) lost that sealing; the archive is Playground-only.

Measured on map 2 (60 bot runs, all nine bricks needed): 42 won, 15 ran out of
time, 3 buried a brick, none locked out. The bot now looks before it fences
(`lib/bot/lookBeforeFencing.ts`), as a player does by eye; a bot fencing
blindly buried the block in 52 of 60, which is the rule doing what it says.

A fence drawn ACROSS a brick does not bury it (2026-11-23, reported from play
on map 2: the top row vanished under a fence with the ball beside it). The
line takes the cells under itself, which can be every cell a brick has, so
burial now also asks that no ball can still strike the brick
(`canStillStrike`); `brickBurial.test.ts` holds it. Before, 159 of 300 random
four-fence games near the block erased a brick that was still beside live
ground; after, 63, each one behind a fence from every ball.

A fence lying ALONG a brick's face puts the brick out of reach (2026-11-23,
the same report, still happening after the fix above). A fence has a body:
drawn along the lower edge of the top row it covered the only face the ball
could hit, the ball bounced off the fence, and the three bricks behind it were
never touched. The reach test asked only whether a line to the brick's edge
crossed the fence's centre, so it called them breakable: no lock (bricks
owed), no loss (bricks "reachable"), 6 of 9 for good. `canStillStrike` now
also refuses a face the fence's body covers, checked against firing a ball at
the row for every fence height (`brickBurial.test.ts`). The map is then lost
when that fence lands, as rule 4 says.

## Open

- The 3 buried: the capture pass keeps a ball-less strip beside the block
  while a narrow gap reads as passable, and drops it when a neighbouring brick
  goes. No fence of the player's causes it.
- Nothing warns before a fence that will lose the map. A preview tint on the
  bricks a drawn line would cut off is the obvious help, if play asks for it.

- Whether "cut the board down to X%" stays a goal on most maps or steps back.
- The slingshot as a standing tool, and where on the ladder it arrives.
- Brick types (armoured, explosive, regenerating) and the cards for them.
- Scoring: breaking as a main source of pay, not a side bonus.
