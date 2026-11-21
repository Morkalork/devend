# CARDS_PLAN.md

The redo of the upgrades as a card draft. Status: **phases 1 to 6 built**;
what is still open is listed at the end. Why: the owner's report that "the upgrades don't change the game
enough" and that the feeling of being handed just the right card (Slay the
Spire) was missing, and the sweep that measured it (UPGRADE_SWEEP_REPORT.md):
of 145 upgrades, 20 changed a map clearly, and the ones that did added a rule,
not a number.

## What was wrong with the classic store

1. Most upgrades were a stat nudge of 15% or less, below what play can feel.
2. 145 cards were 57 ideas cut into Junior / Senior / Principal rungs, so most
   store visits offered "a bit more of what you have".
3. Nothing cost anything but hours: no limit, no downside, so there was no
   wrong card, and so no right one.
4. Synergy counted tags ("+4% per other bank upgrade") instead of pairing a
   card with the card that makes it good.
5. Cards that only work on some maps were bought blind.

## The draft rules (`src/lib/cardRules.ts`)

A run plays ONE rule set, fixed when it starts and saved with it (`ruleSet` on
the run save), because the two read different catalogues:

| | classic | draft |
|---|---|---|
| Catalogue | `public/upgrades.yml` | `public/cards.yml` |
| After a map | buy what the hours afford | the **pick**: `PICK_CHOICES` cards, take one, free (if the map locked enough balls to open the store); a won contract deals the pick from the rarer cards |
| After a boss | the same store | the **shop**: the pick, then `SHOP_CHOICES` priced cards, abilities and rerolls, bought with the hours banked since the last boss |
| Build | no limit | `CARD_SLOTS` cards; one more means giving one up |
| Hours buy | cards, every map | the shop's shelf, a reroll (`REROLL_HOURS`, rising per visit), abilities: at the shop only |
| Ladders | Junior to Wizard | a card and at most one upgrade, its "+" |

New solo runs play the draft. **Admin > "Classic store for new runs"** switches
back, for comparing the two; the toggle is a solo preference only. A pair run
and the Daily play the draft whatever it says: both phones (and every Daily
player) must read one catalogue, so neither can follow a per-phone preference,
and the draft is the game's store now. The pair's shared store is the draft
screen with the host's picks.

A "+" (`upgradeOf: <card>`) requires its card, rides on it and takes no slot;
it turns up on the shelf once the card is held. Giving a card up gives up its
"+" with it. The store shows the next map's features (balls, boss, movers,
gravity well, breakables, syntax areas), so a card that needs one is never a
blind pick.

## The catalogue (`public/cards.yml`)

49 cards and 15 "+", one idea each, on the classic schema and the same modifier
pipeline. `tier` is rarity (Junior common, Senior uncommon, Principal rare).
Rules it is held to (`src/test/cards.test.ts`):

- no multiplier moves its number by less than 15%;
- a strong card says what it costs (`downside:`, drawn in red): Technical
  Debt, Crunch Time, the Semaphore, Flare, Tripwire and Redeploy fences;
- every key is one the engine reads; every fence type and certificate exists.

The engines, each an enabler and the card that pays it off:

| Engine | Enablers | Payoffs |
|---|---|---|
| Freeze | Feature Freeze, Cold Boot, Cron Job, Bug Squash | Frozen Assets (frozen locks pay triple), Thaw Cycle (a lock refunds a freeze), Deep Freeze (no cooldown) |
| Ice | Ice Fence | Permafrost (Ice freezes the ball it slows), then every freeze payoff |
| Lock chain | the Mutex and Semaphore fences, Breakpoint | Frozen Assets, Batch Commit, Golden Handshake |
| Multi-lock | Semaphore Fence, Batch Commit | Golden Handshake, Loose Coupling |
| Tempo | Fast Compile, Hot Start, Scaffolding | Multithreading, Continuous Delivery, Ship Early |
| Bank | Performance Bonus, Technical Debt | Compound Interest, Expense Account |
| Fence types | Flare, Guardrail, Tripwire, Redeploy fences | Afterburner, Crash Barrier, Tensioned Wire, Hot Reload (a Redeploy cut throws twice) |

Two keys are new, each with a Playground knob: `iceFreezeSeconds` (Permafrost)
and `freezeUsesPerLock` (Thaw Cycle).

Certificates still chase classic ids, so a card names the chase it counts
toward (`certCredit:`). Sprint Planning and Tenure read the draft catalogue as
it is: a chain is a card and its "+", and the jackpot pays a rare card.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Rule sets, the catalogue switch, the run save, the Admin toggle | built |
| 2 | The draft store: free card, skip, reroll, slots and the replace modal, the next-map line | built |
| 3 | `cards.yml`, the two new mechanics, Tenure and Sprint Planning on cards | built |
| 4 | The sweep run on `cards.yml` and the catalogue tuned from it; card text in es, sv and bn | built |
| 5 | Contracts (the draft's elite maps), payoff cards for the Flare, Guardrail and Tripwire fences, the draft's own panel wording | built |
| 6 | The earned store: no free card, every card priced at an ordinary map's pay, a won contract deals one | built |
| 7 | The pace measured and the draft's own inflation; the contract on the board; Hot Reload for the Redeploy fence; the shelf leans toward payoffs; Daily and pair on the draft; the human pass list | built |
| 8 | The pick and the shop: one card free after every map, the hours spent at the shop after a boss | built |
| 9 | The verb cards: Breakpoint, Stash, Refactor, Merge Conflict and Rate Limiter, each a new thing a finger does | built |
| 10 | The cut: eight cards the player could not feel removed (Ghost Protocol, Knowledge Transfer, Compression, Containment, Load Balancer, Moonshot, Padded Estimate, Stock Options) | built |

## Build record

**Phases 1 to 3.** The store is still `UpgradeShop`, given a `draft` prop: the
free card is a price of zero on the first card picked (`draftStoreModel.ts`),
the slot rule opens `ReplaceCardModal` before a pick that would not fit, and
`DraftBar` carries the visit's rules, the reroll and the next map. The shelf
is `rollShelf` with no locked teaser. Gallery: `UpgradeShop-draft`,
`ReplaceCardModal`. Tests: `cards.test.ts`, `draftStore.test.ts`,
`cardMechanics.test.ts`. Analytics: `draft_choice` (take, skip, reroll, drop).

**Phase 4.** The sweep reads the draft catalogue (`UPGRADE_SWEEP_CATALOG=cards`)
and plays named builds (`UPGRADE_SWEEP_BUILDS=a+b`), which is how a payoff card
is read: alone it has nothing to pay off. Same method and noise floor as
UPGRADE_SWEEP_REPORT.md (15 maps, 16 seeds, each "+" on top of its card).

| | classic (145) | draft (61) |
|---|---|---|
| Clear (over 2x the noise) | 20 (14%) | 28 (46%) |
| Weak (1x to 2x) | 26 | 7 |
| Within the noise | 55 | 15 (Moonshot among them: the bot never pushes its luck) |
| Never changed a run, though the bot plays it | 7 | 0 |
| Not measurable by the bot alone | 37 | 11: five payoffs read in builds below, Fault Tolerance, Scrum Master, Control Freak and the three store cards |

What it changed:
- **Loose Coupling** read as nothing, because the lock limit was widened only in
  GameCanvas; the bot now applies it too. Measured, it is among the strongest
  cards (+39% pay, 13% faster clears), so it moved from common to uncommon.
- **The freeze payoffs are small for this bot** (Frozen Assets +5.6% pay on top
  of Feature Freeze, Thaw Cycle and Deep Freeze under 2%): its only freeze
  habit is saving a fence, never setting up a frozen lock. Frozen Assets went
  from triple to four times; the other two are left for play to judge.
- Permafrost changes nearly every run it is in (233 of 240) but nets out near
  the noise for the bot, like the Ice fence it rides on.
- Compression, Containment, Cron Job, Ghost Protocol and Knowledge Transfer
  sit in the noise for the bot. Left as they are: each is a rule a player can
  build on, and the bot plays no build.

Card text is in es, sv and bn under `content.cards` (its own namespace: eleven
card ids are also classic ids with other numbers on them), and `cards.test.ts`
holds the numbers in every language to the English.

**Phase 5.**

*Contracts* (`src/lib/contracts.ts`, the `contracts:` block of `cards.yml`) are
the draft's elite maps. From the store before map 4 on, and never before a
boss, the draft bar offers one hard rule for the NEXT map only: Hotfix Friday
(balls 30% faster), Scale-Up (balls 30% bigger) or Legacy Code (fences 35%
slower), in turn by map number, so each comes round and none needs forcing.
Take it and win the map, and the store after it deals **two free cards from
the uncommon and rare ones**. Each asks a different question, so a build
answers some better than others: slow and freeze for the fast balls, shields
and Compression for the big ones, tempo for the slow fences. The rule rides
the ordinary modifier merge for that map (`activeContractId` in the session),
is saved with the run, and survives a Continue on the same map.

*Fence payoffs.* Three cards, each with a new key and a Playground knob:
Afterburner (`fastLockBonus`: a ball locked while running faster than its base
speed pays triple, which is what a Flare fence sets up), Crash Barrier
(`guardrailExtraShields`: two more Guardrail shields a map) and Tensioned Wire
(`fenceExtraHits`: a Tripwire survives two more touches). The Mutex and
Semaphore fences already had theirs (Golden Handshake, Batch Commit).
Measured in builds: Afterburner +22% pay on top of the Flare fence; Tensioned
Wire +5%; Crash Barrier near nothing for the bot, which rarely loses two
fences on one map.

*Wording.* In the draft the store's panel reads "Your picks" and "Cards", and
the button says what it takes.

**Phase 6: the earned store.** The draft opened as "take one card free a map,
or skip it for hours", and played, that was too many cards too early: with
the free card and a second bought when the hours allowed, the build of six was
full by map 4 and every store after it was a swap, which is a decision about
what to lose rather than what to build. The owner's rule for the redo: *a
normal run affords one card a map, and more has to be earned on the board.*

So nothing is free at an ordinary store any more. `SKIP_HOURS` is gone with
the free card (there is nothing to skip), `freePicks` defaults to none, and the
contract's payout is **one** free card from the rarer ones rather than two:
with the ordinary free card gone, one is the whole reward and the only free
card a store deals. The run's one free card is the Sprint Planning offer
before map 1, which stays as it was.

The price is what makes the rule true. `cards.yml`'s anchor is **23h** (the
classic store's is 48): `upgradePricing.ts` measured, through `calculateScore`,
flawless 47h, good 34h, ordinary 16h, scrappy 6h, and 23 x 0.7 puts a common
card at 16h, an uncommon at 22h and a rare at 30h. An ordinary map buys one
common, a good map two, a flawless map three; a scrappy map buys nothing and
banks toward the next. `blockInflation` is unchanged, so prices still climb
15% per five maps as a build's pay does. `draftStore.test.ts` pins the common
card's price to the ordinary figure.

What the bar says changed with it: "Every card costs hours. A good map pays
for more than one." at an ordinary store, and the contract's line at the one
after a won contract. In every language.

**Phase 7: the pace, the board, the last engine, and what only a person can
judge.**

*The pace, measured.* A pay sweep (the bot on the sweep's fifteen sample maps,
16 seeds each, no cards, 3 lives, the draft catalogue's prices) read the hours
a won map pays against the common card's price at that map. Pay is the map's
`calculateScore` through the store's own conversion, so it is what the player
would see on the shelf:

| map | common at 1.15 | common at 1.06 | wins /16 | median pay | pay range | wins that afford one (at 1.15) |
|---|---|---|---|---|---|---|
| 2 | 16 | 16 | 11 | 9 | 9-13 | 0 |
| 4 | 16 | 16 | 10 | 25 | 18-30 | 10 |
| 6 | 18 | 17 | 2 | 8 | 7-8 | 0 |
| 8 | 18 | 17 | 13 | 18 | 14-37 | 9 |
| 10 | 21 | 18 | 3 | 18 | 12-19 | 0 |
| 12 | 21 | 18 | 16 | 17 | 10-39 | 5 |
| 15 | 24 | 19 | 15 | 22 | 16-33 | 5 |
| 18 | 24 | 19 | 12 | 15 | 6-23 | 0 |
| 20 | 28 | 20 | 3 | 31 | 25-33 | 2 |
| 23 | 28 | 20 | 11 | 14 | 11-19 | 0 |
| 26 | 32 | 21 | 11 | 32 | 15-40 | 6 |
| 29 | 32 | 21 | 14 | 18 | 11-26 | 0 |
| 32 | 37 | 23 | 7 | 29 | 17-35 | 0 |
| 36 | 43 | 24 | 7 | 20 | 17-26 | 0 |
| 40 | 49 | 26 | 2 | 32 | 25-32 | 0 |

Two readings. First, the bot plays a scrappy-to-ordinary map (it never pushes,
rarely clears fast, loses lives), and its median pay sits at 15-30h across the
whole ladder, flat: the scoring axes are absolute, so map 29 pays what map 8
does. Second, the classic store's 1.15 per five maps was written for a
catalogue whose bank cards raise pay with the run; against the draft's flat
pay it tripled a common by map 40, and from map 23 on not one of the bot's
wins afforded a card. So the 23h anchor stands (it matches an ordinary
clear, which the bot confirms, and a human's ordinary map pays more than the
bot's) and `cards.yml` sets its own **`blockInflation: 1.06`**: a common is
16h at map 4 and about 26h at map 40, under a good map's 34h the whole way,
so one card an ordinary map holds for the run and a good map buys two at the
end as at the start. `draftStore.test.ts` pins the late price under 34h. The
sweep itself was a one-off test file, run and deleted; the numbers are the
record, and `upgradeSweep.test.ts` is the tool to rerun it with.

*The contract on the board.* A contracted map now wears its contract where
the mutator banner sits: `MapRuleBanner` takes `contract`, and `mapRuleText`
names it alone (the store's contract colour, so the two agree) or next to the
mutator ("Shifting gravity + No fence lost"). It announces for `ANNOUNCE_MS`
like a mutator and then folds to its chip; the Specs panel still carries the
full terms. `GameScreen` passes `session.activeContract`, and the gallery has
it as `MapRuleBanner-contract`.

*Hot Reload: the Redeploy fence's payoff.* Senior, map 9, risk and tempo:
a Redeploy fence reloads once, so a cut can be thrown twice before it is
spent. `slingExtraThrows` on `GameModifiers` (the Playground knob "Redeploy
Extra Throws"), carried onto the board as `game.slingExtraThrows`, and
`fireSlingFence` counts throws on every segment of the cut, so a bounced cut
is still one fence with one reload. Every fence type now has its payoff.

*The shelf leans toward payoffs.* `paysOff: [card, ...]` on a card names what
it is a payoff for, and the shelf roll weights a card `PAYOFF_WEIGHT` (3)
times its tag weight when one of those is held, in both passes of the roll.
It is a lean, not a guarantee: the shelf is still a draft. The ticket says
"Pays off: Rolling Redeploy", and "Pays off a card you hold" when it does, so
the "right card" feeling has a reason the player can read. Seventeen cards
carry it (the freeze ladder, the bank chain, Multithreading, Continuous
Delivery and the fence payoffs among them); `cards.test.ts` checks every id
named exists and no card pays off itself.

*Daily and pair on the draft.* The Daily plays the draft for everyone, so
one seed deals one shelf; a pair run plays the draft because the guest is
gated on the host's record and adopts it, and a per-phone preference could
have put the two phones on two catalogues. The Admin toggle is a solo
preference. The pair's store is the draft screen, with the host's picks.

*Stale strings.* "One free card a map" was still in Admin's toggle
description and in CLAUDE.md; both now say every card is bought.

*What only a person can judge.* The bot's sweep reports a card as unchanged
when the bot cannot use it, and the paired difference of many cards sits
under the placebo's, so these go on the human playtest list rather than on
the "does nothing" list:

- *the bot cannot reach them:* Frozen Assets, Thaw Cycle, Deep Freeze and
  Permafrost (it never taps a frozen ball with intent), Afterburner, Crash
  Barrier and Tensioned Wire (it does not throw or aim at a fence type's
  moment), Fault Tolerance, Scrum Master, Control Freak, Expense Account,
  Headhunter, Compound Interest (purse, shop and hold decisions it never
  makes);
- *in the noise:* Compression, Containment, Cron Job, Ghost Protocol,
  Knowledge Transfer, Moonshot, and the +1s and +5% "+" cards generally: a
  change the simulation cannot tell from balls 0.1% slower may still be one
  a player feels, or may be a card to cut.

The question for each is the same: after ten maps with it, did the build play
differently, and did the player know why. That is a playtest, not a sweep.

**Phase 8: the pick and the shop.** The owner's design, from before phase 6,
was Slay the Spire's and not a price rule: *one card after every map, one
only, as long as enough balls were locked, and the hours buy something else,
at a special shop after each boss.* Phase 6 had read "one card a map" as a
price and built the earned store, where a scrappy run fell behind on cards
as well as on hours. This phase builds the design as it was meant.

Two stores (`storeKindAfter` in `cardRules.ts`, decided by whether the map
just cleared was a boss):

- *The pick*, after an ordinary map: `PICK_CHOICES` (3) cards, one taken
  free, nothing else on the shelf. No ability slot, no reroll, no prices:
  the sprint's capacity line reads zero committed because nothing here can
  be committed. A tap on a second card replaces the first, since one card is
  the rule and a change of mind should not need an un-tap. The lock toll is
  the gate the owner named: a map that locked too few balls opens the store
  closed, as it always has, and a closed store deals no pick. A won
  contract's pick comes from the uncommon and rare cards (`rareShelf`).
- *The shop*, after a boss (maps 10, 20, 30, 40): the same free pick, then
  `SHOP_CHOICES` (5) cards plus the build's extra shop items, the ability
  slot, and the reroll, all bought with the hours banked since the last
  boss. The pipeline strip names the stage "Shop" and its button "Open the
  shop" (`BetweenMapPlan.shop`), so the player sees the shop coming from
  the debrief.

The build grows at one card a map for everyone; what a run earned on the
board shows at the shop, where four or five maps of pay buy two to four
cards' worth for a run that played them well and less for one that did not.
The prices and the 1.06 inflation from phase 7 stand, now applied at the
shop only. `CONTRACT_FREE_PICKS` is gone (the free card is every store's,
`FREE_PICKS`), and the contract's reward is the rarer pick. The Admin
toggle's text, the catalogue header and CLAUDE.md say the new rule;
`draftStore.test.ts` pins the store kind per map, the free pick, the bar's
lines and the component's pick-mode seams; `pipelineModel.test.ts` the shop
stage. The gallery has the pick (`UpgradeShop-draft`) and the shop
(`UpgradeShop-shop`).

**Phase 9: the verb cards.** The owner's complaint, after the pick and the
shop: *the cards only provide statistical upgrades; very few change the
gameplay. The one that lets you hold a moving object is great, but too few
are like that.* Of 62 cards, five changed what a finger does (the freeze
tap, the mover hold, the Redeploy fling, Scrum Master's drawn path, the
Mutex and Semaphore pockets); the rest are a number on a modifier, which is
also the only thing the sweep could measure, so the catalogue drifted that
way. Five more verbs, picked from a list of five plus two, all in
`src/lib/physics/verbCards.ts` and each reached through a command
(`net/commands.ts`), so a pair plays them in lockstep and a replay carries
them:

- *Breakpoint* (Senior, map 3): tap an empty spot to set a trap; the first
  ball across it freezes there for 3s, by the freeze tap's own path. Two a
  map. A tap that froze nothing and landed on open board is the trap; the
  trap is judged again when the command applies, so a ball that rolled
  under the point in the meantime does not get a trap set on top of it.
  Pays off Scrum Master and Frozen Assets.
- *Stash* (Principal, map 5): an ability button, `stash` in abilities.yml,
  marked `cardOnly` so no chest rolls it and no store sells it; the card's
  modifier is what makes it held, and `replenishTo: 1` refills it every map
  while the card is in the build. Pressing it remembers where every ball
  is. The next ball through a fence puts them all back there instead of
  costing a life (`ballStruckFence`, after the shields and the push, before
  the life). Only the balls and the movers go back: a fence drawn since
  stays, space captured since stays captured, and a remembered spot that
  has been captured is no place for a ball, so that ball keeps where it is.
- *Refactor* (Senior, map 4): press and hold a finished fence to delete it,
  once a map, through the fence-break path (`pendingWallBreaks`), so the
  regions it separated merge again. The void rule holds: a fence with
  captured space on one side is load-bearing and stays, said in the message
  bar, and the ration is not spent. A loaded Redeploy fence is a grab, not a
  hold. The hold shares the explainer's timer and slop.
- *Merge Conflict* (Senior, map 6): two plain balls that collide fuse into
  one, area added, momentum shared and then slowed by 15%, lock bonus
  summed. Bosses, minions, special balls and frozen balls never merge, and a
  ball that would come out past 2.2 base radii bounces instead. Pays off
  Loose Coupling and Golden Handshake.
- *Rate Limiter* (Junior, map 2): tap a wall, the board's or a fence, and a
  stretch of it is sticky for 2s; the next ball to hit it stops dead for 3s,
  by the freeze hold. Three taps a map. Judged before the trap on a tap, so
  a tap beside a fence is read as aimed at the fence.

Each has a Playground knob, a mark on the board (the fx layer: a breathing
dashed ring for a trap, an amber band draining along a sticky wall, rings
for a trap firing, a merge and a restore), its description in four
languages and a test of the rule. The bot cannot play any of them, which is
the point: the sweep measures numbers, and these are not numbers. The
"in the noise" list from phase 7 is where the next cuts come from if the
catalogue is to stay at about fifty.

**Phase 10: the cut.** Asked for the five most boring cards, the answer was
the sweep's noise list read against the catalogue: Ghost Protocol (a quarter
second of fence grace nobody sees), Knowledge Transfer (a ramp that pays
after the last lock), Compression (pockets scale with the ball, so a smaller
ball locks no easier), Containment (a three-second hold on a ball on the
wrong side of the fence) and Load Balancer (one ball a fifth slower, inside
the ordinary spread), with Moonshot, Padded Estimate and Stock Options as
the mentions (double a bonus most players never reach). The owner cut all
eight, "+" riders included. The classic catalogue keeps its versions, so
their modifier keys stay in the engine; the draft is 47 cards. Soft Launch,
named as Load Balancer's twin, was not on the list and stays.

Still open:
- the verb cards have no counter in the top bar: the ticket says the ration
  and the marks say what is set, but "how many traps do I have left" is a
  question the board does not answer yet;
- Kill Switch and Hotpatch, the two of the five the owner did not take,
  stay on the list;
- the shop's shelf is the ordinary catalogue priced; a shop-only catalogue
  (a card removal, a relic-like permanent, the "+" of every held card dealt
  together) would make the shop a different place rather than a bigger
  store;
- the pay sweep in phase 7 read hours per map against a card's price; under
  the pick and the shop the question is hours per act against the shop's
  shelf, and has not been measured;
- no boss or authored map has been changed: contracts are the build test, and
  the ladder's own maps are as they were;
- the human pass above has not been played yet; a card on the "in the noise"
  list that a playtest cannot feel either should be cut or made bigger;
- the pay sweep measures the bot; a human pay per map, read from the saved
  runs once there are some, is the number to re-anchor on.
