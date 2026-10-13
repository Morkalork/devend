# Sprint Planning, redone: the run-start offer

The plan and its build record. **Built** (section 9 records what shipped and
where it differs from the plan below); the owner confirmed the Tenure fold
(decision 1).

## 1. The ask

The old loadouts (curse + blessing bundles, `public/loadouts.yml`, drafted on
`RunDraftScreen` before map 1) are parked. They were a stat trade: 25% faster
balls for 25% more overtime, 30% bigger balls for 35% faster fences. Every
number in them is a number the shop already sells, so a loadout was never
something you could not get otherwise, only something you got earlier and paid
for with a drawback that was dull to carry for 35 maps.

The new shape is Slay the Spire's opening gift. Neow offers three or four
things from different pools: a small safe boon (max HP, a common relic), a
boon with a price (lose max HP, take a rare card), and now and then the
jackpot (a boss relic). You always get *something*, the floor is useful for the
first three fights, and the ceiling defines the run.

The owner's specific want: a card you **cannot get in the game**, that belongs
to a category of upgrade (defensive, say), and **improves the odds of seeing
that category** for the rest of the run. That card is the centre of this plan.

## 2. What the engine already gives us

The build system is further along than the loadouts were, and the new draft
mostly plugs into it:

- **Six archetype tags** on every upgrade (`UpgradeTag`: lock, freeze, bank,
  tempo, risk, safety; 138 upgrades, most carrying one tag). Counts today:
  safety 38, tempo 38, risk 32, bank 24, freeze 21, lock 18 (double tags
  counted twice).
- **Tag-weighted shelf** (`weightedSample` in `src/lib/upgradeTags.ts`): a
  candidate's weight is `1 + owned upgrades sharing a tag`, then a recency
  factor. The whole "improve the odds of a category" mechanic is one extra
  term in that weight.
- **Set bonuses** (`tagSets` in `upgrades.yml`): own 3 of a tag and a free
  bundle switches on (Insurance Policy, Ship It, Chain Reaction, ...).
- **Chain grants** (`src/lib/tenure.ts`): Tenure already resolves and grants
  whole Junior → Senior → Principal chains, choice groups decided for the
  player. A "free rare card" offer is this code with a different trigger.
- **One modifier pipeline** (`useActiveModifiers`, source kinds `upgrade |
  certificate | achievement | loadout | tagSet | capstone`). A new source kind
  is a one-line union change plus a merge call, and the HUD's details panel
  lists it for free.
- **Draft screens** (`DraftCard`, `DraftFrame`, `DraftGrid`, `draftModel.ts`):
  Tenure, Promotion and the old loadout draft share them. The new screen is a
  recomposition, not a new kit.
- **Seeded runs**: `getRunRng(key)` keys every roll to the run seed, so the
  Daily can share one offer for everyone, exactly as the shop shelf does.

## 3. The design

### 3.1 One screen, three cards, from three pools

Before map 1 the run visits **Sprint Planning** (the existing screen name and
i18n key stay). It deals three cards, one from each pool, plus the skip:

| Slot | Pool | What it is | StS analogue |
|---|---|---|---|
| A | **Boon** | Small, safe, immediate. Helps the first three maps. | +max HP, gold |
| B | **Specialisation** | The category card. Permanent, unique to this draft. | a relic you build around |
| C | **Gamble** | A price now, a big prize. The pool has rarities; its top end is the jackpot. | lose HP for a rare card, boss relic swap |

Every slot rolls, so two runs rarely open the same way, but the floor is
fixed: there is always a sane boon, there is always a specialisation.
Pick one. The other two are gone for the run (no "take both" upgrade; the
scarcity is the point).

### 3.2 The Specialisation (slot B)

A Specialisation is **one card per tag**, six in all. It is never on the shop
shelf, never a certificate, never a capstone: the draft is its only door.

Each one does three things, two of them shared:

1. **Affinity**: the shop treats it as **two owned upgrades of its tag** for
   shelf weighting (`weightedSample` counts get `+2` for that tag). With an
   empty build that makes a card of the tag three times as likely per slot as
   any other; later it is a steady lean on top of what the build already
   earns.
2. **A guaranteed slot**: whenever the unlocked pool holds a card of the tag,
   at least one of the shelf's slots is one. Odds are what the owner asked for;
   a guarantee is what a player can *read*. Both, so the card is felt on map 1
   and still felt on map 30 when the pool is wide.
3. **A signature perk**: one effect of its own, a rule the tag's upgrades do
   not sell. These are the "cannot get in the game" part and the only part
   that costs real engine work, so they ship one at a time (section 6).

It also **counts as one owned upgrade of its tag toward the set bonus**, so a
specialised run reaches Insurance Policy or Ship It with two purchases instead
of three. That is the quiet reason to take it over a boon: the set is the
archetype's payoff and the specialisation moves it a whole map closer.

Proposed six, names as placeholders (the owner names things; the game's
upgrades are job titles, so these are teams you join):

| Tag | Working name | Signature perk (new `GameModifiers` key) |
|---|---|---|
| safety | Reliability | `openingSlowSeconds: 8`: balls move at 70% speed for the first 8 s of every map. |
| tempo | Platform | `fenceHeadStart: 0.12`: every fence starts 12% drawn. |
| lock | Containment | `lockStunSeconds: 1`: a lock stops the nearest free ball for a second. |
| freeze | Cold Storage | `startFrozenBalls: 1`: the fastest ball starts every map frozen for 12 s. |
| bank | Procurement | `shopInterestPercent: 5`: 5% of banked hours paid at every store, capped at 10h. |
| risk | Growth | `scoreBonusPerMissingLife: 0.15`: a map pays 15% more for each life you start it below 3. (Built this way; see 9.) |

Each perk is a mechanic the game can show on the board or on the shelf. None
is a multiplier on something the shop already multiplies, which is the test for
"unique": if a perk could be written as a value on an existing key, it is a
boon, not a signature.

### 3.3 Boons (slot A)

Cheap to build, all data. Immediate and small, several of them **time-limited**
so the early maps feel easier without the run being decided:

- `Onboarding Buddy`: 2 instant fences per map, **maps 1 to 3 only**.
- `Signing Bonus`: +30 overtime hours in the bank (the certificate of the same
  name stacks; rename one of them).
- `Spare Laptop`: +1 life.
- `Pick a Junior`: choose any level-1 Junior, free (the StS "common relic":
  the draft shows the four Juniors as the hold-to-explain modal's content).

Time-limited needs one new field on an offer, `untilLevel`, and one filter in
the modifier merge: the offer source contributes only while
`completedLevel < untilLevel`. Small, and it is what makes "help for the first
three fights" a real category rather than a weaker permanent boon.

### 3.4 Gambles (slot C) and the jackpot

A price paid now for a prize that would otherwise take ten maps to reach. The
pool is weighted, and the weight is where the jackpot lives:

| Weight | Offer | Price | Prize |
|---|---|---|---|
| 50 | `Death March` | start with 2 lives instead of 3 | a random **Senior**, its Junior included (a chain, as Tenure grants them) |
| 30 | `Hiring Freeze` | the shop has one fewer slot all run | a random **Principal chain** |
| 15 | `Headhunted` | lose your first Continue | a **Principal chain of a tag you choose** (shows three tags, pick one) |
| 5 | `Unicorn` | none | a random **Architect**, prerequisites waived, plus its chain |

Five percent is the jackpot: once in twenty runs you open with the strongest
card in the game for nothing. Rare enough to be a story, common enough to
exist. The "chain, not the top card" rule is Tenure's and holds here for the
same reason (modifiers compound; a lone Principal is weaker than the Junior
plus Senior under it).

Two of the old loadouts survive as gamble names (Death March, Hiring Freeze)
because the price half of them was fine; it was the prize half that was a stat
bump. The rest of `loadouts.yml` is retired.

### 3.5 Tenure folds into the same screen (recommended, owner's call)

Today a run that earned Tenure visits two draft screens before map 1 (Tenure,
then the loadout draft). Two choice screens before any play is too many, and
Tenure is not a choice at all: a free chain is always taken.

Recommended: **when Tenure is owed, it is slot A.** The boon slot shows the
Tenure chain (resolved exactly as `rollTenureOffers` does now, one offer rather
than three) instead of a plain boon. The player then chooses between the
chain they earned, a specialisation and a gamble, which is a real decision and
the first time Tenure has been one. The reward for depth becomes "your boon
slot is a lot better than usual", which is still a reward.

The alternative keeps Tenure as its own screen ahead of this one, unchanged.
It is safe and it is two screens. The plan assumes the fold; `enterRun` is
where the branch lives either way.

### 3.6 Meta progress: what unlocks

The owner's direction is many maps, replayability and meta progress, so the
pools open up over runs rather than all at once:

- **Specialisations**: three from the start (safety, tempo, bank: the readable
  ones). The other three unlock by *meeting the archetype*: own three upgrades
  of the tag in one run (the set bonus firing is the moment, and the toast
  can say "Containment is now a Specialisation"). The unlock state already
  tracks `metArchetypes`, so the check is a lookup.
- **Gambles**: Death March from the start; Hiring Freeze after the first win;
  Headhunted after reaching map 20; Unicorn is always in the pool (a jackpot
  that has to be unlocked first is not a jackpot).
- **Boons**: all from the start. They are the floor.

The Loadouts menu entry comes back as **Specialisations**: a collection page of
the six cards, locked ones showing how to meet them. One screen in
`src/ui/screens/`, one gallery entry.

### 3.7 Seeds, saves, analytics

- **Daily**: rolls the three cards from `getRunRng('sprint')`, so everyone
  sees the same offer; the pick is theirs. Tenure stays out of the Daily as it
  is now (a per-player head start breaks comparability), so the Daily's slot A
  is always a plain boon.
- **Save**: `RunSave` keeps `offerId` (one string replaces
  `draftedLoadoutIds`), plus whatever the offer granted is already in
  `ownedUpgradeIds`. A run closed on the draft screen itself is not saved; the
  next New Game re-rolls, which is also what StS does.
- **Analytics**: `offer_selected { pool, offerId, skipped }` replaces
  `loadout_selected`; the PostHog report gets the row.

## 4. Data model

New file `public/offers.yml` (replacing `loadouts.yml`; the loader in
`useLoadoutManager` becomes `useOfferManager`, the type `RunOffer` replaces
`LoadoutConfig`):

```yaml
pools:
  boon:
    - id: onboarding_buddy
      name: Onboarding Buddy
      description: Start maps 1 to 3 with two instant fences.
      untilLevel: 3
      modifiers: { instantFencesPerMap: 2 }
  specialisation:
    - id: reliability
      name: Reliability
      tag: safety
      description: Safety upgrades show up far more often, and balls open every map slow.
      affinity: 2            # virtual owned-of-tag for the shelf weight
      guaranteedSlot: true
      countsTowardSet: 1
      modifiers: { openingSlowSeconds: 8 }
      unlock: { kind: archetypeMet, tag: safety }   # omit for the starting three
  gamble:
    - id: death_march
      name: Death March
      weight: 50
      price: { extraLives: -1 }
      prize: { kind: chain, tier: Senior }           # | { kind: chain, tier: Principal, chooseTag: true } | { kind: upgrade, tier: Architect, waivePrerequisites: true }
      unlock: { kind: always }
```

`modifiers` and `price` use `GameModifiers` keys exactly as upgrades do, so the
Playground's `MODIFIER_META` table and the HUD's source breakdown cover them
with nothing new. `prize` is resolved at roll time into concrete upgrade ids
(the card shows what lands, as Tenure's does), and those ids are what the save
and analytics carry.

## 5. Engine hooks, by file

| Where | Change |
|---|---|
| `src/types/offer.ts` (new) | `RunOffer`, the three pool shapes, `OfferPrize`, `OfferUnlock`. |
| `src/hooks/useOfferManager.ts` | loads `offers.yml`; replaces `useLoadoutManager`. |
| `src/lib/sprintPlanning.ts` | `SPRINT_PLANNING_ENABLED` flips to true; `rollSprintOffers(pools, rng, meta, tenure?)` lives here: one card per pool, Tenure folded into A when owed, prizes resolved via `tenure.ts` helpers. |
| `src/lib/upgradeTags.ts` | `ownedTagCounts` takes an optional `affinity: Partial<Record<UpgradeTag, number>>` added to the counts; `computeActiveTagSets` takes `countsTowardSet`. |
| `src/ui/screens/shopModel.ts` `rollShelf` | after the weighted sample, if `guaranteedSlot` and no offer carries the tag and the pool has one, swap the last pick for a weighted pick from the tagged candidates. Restocks (`UpgradeShop.tsx:325`) go through the same counts. |
| `src/hooks/useActiveModifiers.ts` | source kind `'loadout'` becomes `'offer'`; the merge skips an offer whose `untilLevel` has passed. |
| `src/hooks/useGameSession.ts` | `draftedLoadoutIds` → `offerId`; `enterRun` rolls the offer (and no longer branches to a separate Tenure screen if 3.5 is taken); the pick applies `price`, grants `prize` ids into `ownedUpgradeIds`, and records the pool for analytics. |
| `src/ui/screens/RunDraftScreen.tsx` | three cards with pool colours (boon green, specialisation in its tag colour, gamble amber), hold-to-explain modal per card (the standard gesture), skip. Tenure card reuses `TenureDraftScreen`'s chain body. |
| `src/ui/screens/SpecialisationsScreen.tsx` (new) | the collection page behind the returned menu entry. |
| `src/hooks/useRunSave.ts` | `offerId`; old saves with `draftedLoadoutIds` load with no offer. |
| `src/lib/analytics.ts` | `offerSelected`. |
| i18n | `sprint.*` keys for the pools, the skip, the modal copy; `content.ts` maps offer names and descriptions in all three locales. No em-dashes. |

Signature perks each add one `GameModifiers` key, one `MODIFIER_META` knob,
and the mechanic itself:

| Key | Mechanic lives in |
|---|---|
| `openingSlowSeconds` | `updateBall` speed factor while `game.elapsed < n` (the HUD's opening message bar can show "Slow start"). |
| `fenceHeadStart` | `applyCut` fence creation: initial length = `n` of the full span. |
| `lockStunSeconds` | `checkBallWonState` on lock: nearest free ball gets `stunUntil`; `updateBall` honours it like a freeze without the freeze visuals. |
| `startFrozenBalls` | `initGame` after ball placement: freeze `n` balls using the existing freeze path (`ballFreezeDuration` semantics, a long duration). |
| `shopInterestPercent` | `UpgradeShop` open: credit `min(cap, banked * n/100)`, shown as a line on the shelf. |
| `extraPushes` | `PushYourLuckOverlay` allowance. |

## 6. Build order

Each stage is shippable on its own and has its admin control in the same
commit (CLAUDE.md), so a tester can reach every card without playing to it.

1. **Data and the shelf lean.** `offers.yml`, types, loader, `affinity` and
   `guaranteedSlot` in the shelf, `countsTowardSet`. Playground knob: "Sprint
   offer" picker that lists `offers.yml` (never a hardcoded list) and forces
   that card onto a run. Tests: the shelf always holds a tagged card when the
   pool has one; the weight term; the set threshold with a specialisation;
   every offer's unlock is satisfiable (the certificate-reachability test's
   sibling).
2. **The screen.** `rollSprintOffers`, the three-card `RunDraftScreen`,
   `SPRINT_PLANNING_ENABLED` on, Tenure folded (or not), the Daily seeded,
   save and analytics. Gallery entries for the screen in both states (fresh,
   Tenure owed). Tests: one card per pool; Daily determinism; skip leaves the
   run untouched; a resumed run keeps its offer; old saves load.
3. **Boons and gambles.** `untilLevel`, prizes resolved through `tenure.ts`,
   the jackpot weight. Admin: a "force jackpot" toggle (a 5% roll is
   indistinguishable from a broken one from the outside). Tests: a chain prize
   grants the whole chain; a price applies; `untilLevel` expires on time.
4. **Signature perks, one per commit**, in the order of the table in 3.2
   (safety and tempo first: the two starting specialisations most players will
   meet). Each with its `MODIFIER_META` knob and a physics or shop test.
5. **Meta.** Unlocks, the Specialisations collection page, the "now a
   Specialisation" toast, the menu entry. The ledger row in
   MAP_DESIGN_GUIDELINES if any perk changes what a map must account for
   (`openingSlowSeconds` and `startFrozenBalls` do: a map's opening beat is
   designed against the ball speed).
6. **Docs.** ARCHITECTURE.md (flow diagram, the loadouts rows), README-modifiers
   (the offers section replaces the loadouts one), this file's build record.
   Retire `loadouts.yml`, `LoadoutConfig`, `loadoutUnlock.ts`, `wonLoadoutIds`.

Stages 1 to 3 are the feature; a run can open the StS way after stage 3 with
affinity-only specialisations. Stage 4 is what makes them unique and is where
the design risk is, so it goes last and lands one card at a time.

## 7. Balance notes to measure, not guess

- The guaranteed slot on a 3-slot shelf is a third of the store, every store.
  If that reads as "the shop only sells safety now", drop the guarantee to
  every second store or keep the weight alone. The bot sweep in
  MAP_DESIGN_GUIDELINES §8 can run specialised builds the same way it runs
  armed and disarmed blasts.
- `affinity: 2` is a guess. Measure how many of a tag a specialised run owns by
  map 12 against an unspecialised one; the target is "reaches the set one map
  earlier on average", not "every shelf is the tag".
- Unicorn at 5%: if an Architect on map 1 trivialises the first act, the prize
  becomes a Principal chain and the jackpot becomes "two specialisations".
- The time-limited boons must beat "nothing" on map 1 and lose to the
  specialisation by map 5, or the boon slot is dead weight. If players never
  take boons, the floor is wrong, not the ceiling.

## 8. Decisions for the owner

1. **Fold Tenure into slot A** (3.5)? The plan assumes yes.
2. **Names**: teams (Reliability, Platform, Containment, Cold Storage,
   Procurement, Growth) or something else. Also whether the boon "Signing
   Bonus" or the certificate of that name gets renamed.
3. **Starting three**: safety, tempo, bank is the proposal; lock, freeze, risk
   are the ones that need a run to be understood.
4. **The Daily** draws from the same pools (seeded) or skips the draft for
   comparability. The plan says seeded.
5. Whether any of the old curse + blessing bundles are worth keeping as
   gambles beyond Death March and Hiring Freeze. The plan retires the rest.

## 9. Build record

Shipped in one pass, stages 1 to 6 together, because the draft, the shop lean
and the retirement of the loadouts all touch the same session state.

**What exists**

- `public/offers.yml`: 5 boons, 6 Specialisations, 6 gambles.
  `src/types/offer.ts`, and `src/lib/sprintOffers.ts` (parse, unlocks, the
  deal, prizes via `tenure.ts`, the shop lean, what a taken offer contributes).
- `RunDraftScreen` is the three-card draft, with a hold-to-explain modal per
  card. `ChainPickScreen` (grown out of the Tenure draft) follows a choose prize.
  `OffersScreen` is the collection page behind the menu's **Sprint Planning**
  entry and lists all three pools.
- The store reads a `ShopLean`: `shelfTagCounts` adds the affinity to the
  shelf and restock weights, `rollShelf` swaps its last pick for a card of the
  tag when none came up, and `computeActiveTagSets` takes the virtual count, so
  a Specialisation lights its set one purchase early (the HUD and store chips
  show that count too).
- The six signature rules live in `src/lib/offerPerks.ts`, each with a
  `GameModifiers` key and a Playground knob.
- Admin: a Sprint Planning card on the Admin screen forces any offer into its
  slot (locked ones too), forces the jackpot, and shows the draft before it is
  unlocked. In memory, and a forced draw makes the run ledger-ineligible.
- Meta: `metArchetypes` (replacing the loadouts' `wonLoadoutIds`) records each
  tag whose set fired; the result screen names a Specialisation it unlocked.
- Retired: `loadouts.yml`, `LoadoutConfig`, `useLoadoutManager`,
  `loadoutUnlock`, `loadoutDraft`, the loadout gallery, and the 'loadouts'
  feature (legacy players are seeded 'sprintPlanning').

**Where it differs from the plan**

- **Growth's rule.** Push Your Luck is a mode you enter once per map, not a
  count, so "one extra push" had nothing to attach to. Growth pays 15% more
  overtime per life a map starts below 3 instead: still a multiplier with a
  downside attached, which is what the risk archetype is.
- **Headhunted's price.** Runs start with no Continues, so "lose your first
  Continue" cost nothing. It is balls 10% faster all run instead.
- **Unlock levels.** The ladder has 19 maps, so a "reach level 20" unlock could
  never fire. Hiring Freeze opens at 8, Architectural Review at 10, Definition
  of Done at 12, Headhunted at 15; `sprintOffers.test.ts` pins every unlock to a
  level the ladder has.
- **Two more gambles.** Definition of Done (the card that changes what winning
  means) and Architectural Review (bent fences, the card that changes the verb)
  were the two loadouts with mechanics nothing else hands out, so they carried
  over as gambles whose prize is a rule rather than upgrades.
- **`forMaps`, not `untilLevel`.** Counted from the run's own start, so a Head
  Start certificate (which starts runs at level 5 or 10) does not swallow a
  "first three maps" boon.
- **Tenure's card** shows one chain: the one `rollTenureOffers` guarantees
  continues the last run's build.
- **When the draft opens.** Sprint Planning is a feature unlock at clearing
  level 3, so the very first run is just the game. It also opens whenever
  Tenure is owed (Tenure is its boon card). The Daily deals seeded; a pair run
  and the debug jump skip it.
- **Granted lives.** A prize or Tenure chain that carries `extraLives` now adds
  the life, as a purchase does. The old Tenure grant did not.

**Noticed, not changed:** Tenure's 20- and 30-level thresholds cannot be
reached on a 19-map ladder, so today Tenure only ever pays one tier. They will
start paying as the ladder grows toward the planned map count.

