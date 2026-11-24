# Bosses: Legacy Systems (plan)

The setting for bosses on the brick ladder. Not built yet; this is the design
to agree on before the first one is.

## Why a new setting

The old bosses were balls the map brought: lock the boss inside the boxes,
survive its spit-outs and fence wipes. Under the ball tree a map brings no
balls, and BALL_TREE_PLAN.md section 6 decided on 2026-11-22 that **the boss is
the board**. The bot players confirmed the old shape does not survive the
roster. Archive 10, the first old boss, is lost on 117 of 120 attempts to "boss
left outside", which is about where the boss ball spawns and not about the
player at all.

So a boss is no longer something you trap. It is something you **break**,
which is what the brick pivot put at the centre of the game, and it **fights
back by changing the board**.

## The setting

Every boss is a **legacy system**: the old code at the heart of the company
that nobody dares touch, and that has to be taken down before release. It
stands in the middle of the board as a fortress:

- **The Core**: one large monolith with many hits (`hitsToBreak` 12 to 30).
  Breaking it is the win.
- **The Shell**: rings of bricks around the Core, one to three hits each. They
  are in the way of the win, not in it: the Core can be reached through any gap.

The system defends itself with **incidents**: telegraphed changes to the board,
each a map beat with a warning banner first. The office words are the
mechanics:

| Incident | What it does | What it tests in a build |
|---|---|---|
| **Patch** | Rebuilds the Shell's broken bricks, except where a ball stands or the ground is claimed | breaking fast: weight, more balls |
| **Rollback** | Cracks the newest fence, or every fence on its line | fences: speed, fences at once, Guardrail, shields |
| **Hotfix** | A speed spike for every ball (`speedSpike`, exists today) | control: pace, frost, Feature Freeze |
| **Code freeze** | The Core is untouchable for a few seconds; hits glance off | timing: a ball held back (freeze) is not wasted |

Incidents are triggered two ways:

- **on the clock**, every N seconds (Patch, Hotfix);
- **on the Core's damage**, at two thirds and one third left (Rollback, Code
  freeze), so the fight escalates as the player gets closer, the three-act
  shape the old phases had.

## The rules a boss keeps

These are the design card's rules applied to a fight:

1. **Fair to one ball.** The Core can be broken with the one ball a run starts
   with and the standard fence, inside the clock. A fleet or a stacked ball
   makes it faster, never possible.
2. **Every incident is telegraphed.** A banner and a lead time, the beat
   machinery's `announce` and `leadMs`. Nothing changes the board without
   warning.
3. **No fail the board does not show.** The only losses are the clock and the
   Core being fenced off from every ball (brick rule 4, "objective buried").
   There is no boss ball, so no "boss outside".
4. **Two answers.** Through the Shell (break a gap, then the Core) or around
   it (fence the ball into a pocket against the Core's open face). The build
   decides which is cheaper.
5. **It pays like a boss.** A high base (`points` around 40) and a bonus for
   breaking the Core early. The tree stage after a boss is the big one: the
   draft's "shop after a boss" rule carries over.

## How each player meets it

The checklist's build target, read for a boss: at least two of the six should
beat Casual by 15 points, each a different way.

| Player | Its route |
|---|---|
| Fleet | More balls on the Shell outrun the Patch; the Core takes hits from several sides |
| Super Ball | Weight 3 goes through Shell bricks in one hit and dents the Core hardest |
| Fence Engineer | Fences the ball against the Core's face; rebuilds fast after a Rollback |
| Safe Hands | Survives Rollback and Hotfix: shields, grace, freezes during the speed spike |
| Overtime Earner | Arrives with the most bought, and the early-break bonus pays it back |
| Casual | The baseline: should win 30-60% of attempts, a lower band than an ordinary map |

## The first one: "The Monolith"

Proposed as map 5, closing the brick ladder's first act. It holds one Core,
one Shell and two incidents, so it teaches the setting on its own:

- **Core:** 16 hits, in the middle.
- **Shell:** ten 2-hit bricks, with a gap facing a different way on each of
  the four deals.
- **Patch** every 15 seconds.
- **Rollback** once, at half the Core's hits.
- **Clock:** 75 seconds.
- **Points:** 40.
- **Win:** smash the Core (`smashed`, 1 of `monoliths`); the Shell counts for
  nothing.

Later systems, one new incident each, in line with "teach one thing at a time":

- **Spaghetti Code** (act II): the Shell is movers wound round the Core, and Rollback is the incident.
- **The Mainframe** (act III): two Cores, and a Code freeze that alternates between them.
- **The God Class** (act IV): the Patch grows the Shell outward each time instead of rebuilding it.

## What it needs from the engine

The pieces are small, because most of the fight is beats and breakables that
already exist:

1. **A beat trigger on damage:** `atCoreHits`, firing when the named
   breakable has taken that many hits.
2. **A Patch effect:** `restore: [brick ids]`, rebuilding broken bricks.
   - A brick is skipped while a ball overlaps it or its ground is claimed, so
     a Patch can never trap a ball or reopen taken ground.
3. **A Rollback effect:** `crackFences: newest | line`, using the fence
   fracture code the old fence wipe already has, sourced from the Core instead
   of from a boss ball.
4. **A Code freeze effect:** `shieldSeconds`, during which the Core takes no
   hits and shows it.
5. **A Core health bar** on the canvas HUD, with an entry in the Admin
   screen gallery.
6. **Admin and tests:**
   - Beats stay YAML-authored, as `adminCoverage.test.ts` records.
   - The Playground opens the boss map like any other.
   - A test holds every incident to having a telegraph.
7. **The bot:** it already avoids burying a needed breakable. A boss band in
   the checklist (Casual 30-60%) for maps marked `boss`.

## Open for the owner

- Map 5 for the first boss, or later once act I is longer?
- Should a won boss hand out something beyond hours (a free rung, a node), as
  the old bosses unlocked features?
- Should the Patch rebuild bricks under claimed ground as solid wall, so
  fencing near the Core has a cost, or never?
