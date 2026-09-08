# Test fixtures

## `retired-maps.yml`

The ladder's old maps 11-35, removed from `public/map.yml` when act II onwards
was scrapped for a rebuild against the difficulty contract in
`MAP_DESIGN_GUIDELINES.md`.

**They are not content.** The game never loads this file: it is not in
`public/`, so it is not served, not bundled, and not in the level sequence.
Nothing here is playable and nothing here is a design the rebuild has to honour.

They are kept for two reasons.

**1. The engine outlived the maps.** Portals, gravity wells, launchers, movers,
one-way walls, terminals, charges, data streams, deformables, phasing walls,
ball gates and the boss phases are all still in the engine, and the rebuilt
ladder will use them. Their tests were written against the map that happened to
carry each mechanic, so deleting those maps would have deleted the only coverage
the engine has for a dozen mechanics - and the rebuild would then be authored on
top of untested physics. Pointing those tests here keeps the coverage while the
ladder is empty.

**2. A reference while authoring.** A retired map is a worked example of the
YAML: how a portal pair is wired, what a boss phase list looks like, what a
launcher barrel needs to be. Reading one is faster than reconstructing it from
the types.

### Which file a test should read

| the test is about | read |
|---|---|
| an engine mechanic (does a portal move a ball, does a drain hold one) | `ENGINE_MAPS` |
| the ladder's shape (acts, debuts, win coverage, the mechanic spread) | `LADDER` |

`maps.ts` exports both. A ladder test that reads `ENGINE_MAPS` will pass on a
retired map and tell you nothing about the game; an engine test that reads
`LADDER` alone will go vacuous the moment the mechanic's map is gone, which is
exactly what happened here.

### When a mechanic comes back

Once a rebuilt map carries a mechanic, its engine test covers the new map
automatically - `ENGINE_MAPS` is the ladder first, then the retired set. When
every mechanic in here has a home on the real ladder, delete the file and the
`RETIRED` half of `maps.ts` with it.
