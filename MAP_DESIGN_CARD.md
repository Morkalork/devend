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

## 5. Build to the engine

Gaps are 12 or less, or 60 or more. Leave drawing lanes where cuts are meant
to go. Nothing overlaps. From level 4 the map is dealt in four rotations:
"down" does not turn, authored coordinates are not runtime coordinates, and a
column that stands on one deal is a row on another.

## 6. Measure, do not eyeball

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

Then go through section 10 of the guidelines, item by item.
