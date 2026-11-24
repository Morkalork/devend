# MAP_DESIGN_CARD.md

Read this before placing anything on a map. It is one page on purpose: the
rules that decide whether a map is GOOD, as opposed to merely valid. The full
reasoning, the ladder and the engine constraints are in
**MAP_DESIGN_GUIDELINES.md**; this is what to hold in your head while drawing.

## 1. Write the premise first

`premise:` in map.yml, one sentence, "the one where...", before a single
entity exists. A map that cannot state its idea in one sentence does not have
one yet, and every weak map in the play review was a map like that.
(`mapPremise.test.ts` refuses a shipped map without one.)

## 2. Every object is a promise

Everything on the board is **in the win**, **in the way of the win**, or the
map's **named greed hook**. Nothing else.

- **The new mechanic is needed to finish.** A mirror no fence has to bend, a
  well no ball has to fall through, a patrol the win routes around: all
  decoration. Put the mechanic between the player and the win.
- **Every class of breakable shown is counted.** Shards and monoliths are two
  things; a map with both asks for both, per class.
- **A bonus zone is a greed hook or nothing.** It must pay for a real risk and
  be safe to skip. In act I, every box is part of the win.

What rated well: 14 ("introduces gravity without distractions"), 17 (the
balls are the hammer), 18 (the windmill turns inside the room the map pays
for). What rated badly: a box, a chest, a mirror or a patrol the win ignored.

## 3. Hard, but never unfair

A map is hard because the board poses a problem with **more than one answer**
and the build decides which is cheapest. Never hard by precision, never by
build, never by a fail state the board does not show.

- **Slack:** every counted clause has a spare, per class, and in different
  LANES, not just different objects.
- **No single fence quietly ends the map.** A fence that would bury a slab the
  win needs, or leave no ball able to reach its zone, is refused with a
  message. Anything else that strands the map must be warned before it happens.

## 4. Teach one thing at a time

One new mechanic per map (Meet), then Use, Fight, Break. Combine only
mechanics met at least two maps earlier. A map that is the same furniture as
its neighbour with one object added is a repeat, not a Meet (13 was 12 plus a
mirror, and read that way).

## 5. The balls are the player's

A map brings no balls (BALL_TREE_PLAN.md). `maxBalls` is a **cap** on the
player's roster, never a floor: a run may be played with one ball from the
first map to the last, so every map must be clearable, and fair, with one
ball and the standard fence. Difficulty comes from the board: the clock, the
fence budget, the capture target, the bricks, movers, wells and the lock or
brick goal. A goal counted in balls ("lock two") is a lean toward the fleet,
and needs a one-ball route beside it (`ladderRoster.test.ts` holds both).
Nothing on the ladder may require a purchase. A boss is the board, not a ball.

**Every map after the first tests one thing a build buys**, and says which in
its notes: tough bricks (weight), several pockets at once (balls), a tight
clock over open ground (fence speed), fences drawn close to balls (grace,
shields, freezes), a high ceiling for clean play (worth, pay). A map no build
changes is decided by the hands alone, and the tree stops mattering.

**Pay follows difficulty.** A map harder than the one before it pays at least
as much: `points` is the lever. Early maps pay enough to buy something (a
rank-one rung or a Junior root, 15h) after every map.

## 6. Build to the engine

Gaps are 12 or less, or 60 or more. Leave drawing lanes where cuts are meant
to go. Nothing overlaps. From level 4 the map is dealt in four rotations:
"down" does not turn, authored coordinates are not runtime coordinates, and a
column that stands on one deal is a row on another.

## 7. Measure, do not eyeball

Press **Measure pockets** in the Map Builder while drawing: the smallest pocket
one fence closes, whether it grades superior, and how much of the board has
room to draw. Every map offers a one-fence superior nook, or says in
`mapPockets.test.ts` where its precision reward is instead.

Sweep it: 16 seeds, and read the loss kinds, not only the win count. Then
measure the mechanic ITSELF, because the bot cannot see timing, mirrors or
split locks: time a ball spends where the map wants it, crossings through a
door, ball speed over time. Every number in the map's notes names what it was
measured against, since a physics fix can move it (the shard-stack fix moved
6 and 17).

Then play it with the six bot players (BOT_PLAYERS.md), 30 runs each in
practice, with par out of the way so the pay reads as a tidy player's:

```sh
ARCHETYPE_SWEEP=1 ARCHETYPE_OUT=/tmp/p ARCHETYPE_SEEDS=30 ARCHETYPE_ENDLESS=1 ARCHETYPE_PAR=60 \
  npx vitest run src/test/archetypeSweep.test.ts
```

The report's checklist holds every map but the first to four targets:

- **Band:** the Casual player wins 50-80% of its attempts.
- **Build:** some player wins 15 points more than Casual.
- **Losses:** no single cause takes over 70% of them.
- **Pay:** no harder map pays less than an easier one.

A miss is a reason to change the map or to say in its notes why not.

Then go through section 10 of the guidelines, item by item.
