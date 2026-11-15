# Upgrade sweep report

Second edition, run 2026-11-15 on `dev` at `3184eed`. The first edition
(2026-11-14) measured each card alone with a bot that could not use half of
them; it is superseded by this one, and its main finding (Performance Bonus
paid nothing) is fixed. Rerun with `src/test/upgradeSweep.test.ts`
(opt-in, `UPGRADE_SWEEP=1`; see its header).

## The question

Does buying an upgrade change how a map plays enough to matter? The owner's
complaint was that upgrades "don't change the game enough".

## Method

- Every upgrade in `public/upgrades.yml` (145) is played by the headless bot
  on 15 maps across the ladder (2, 4, 6, 8, 10, 12, 15, 18, 20, 23, 26, 29, 32,
  36, 40; bosses included), 16 seeds each: 240 runs per card.
- **Each card is read on top of what it requires.** A card with prerequisites
  is owned with all of them (transitively) and compared with that same stack
  minus the card, so the numbers are **what buying that card adds**. Alone,
  a higher rung is often a bonus to something the build does not have (Feature
  Freeze Senior is +1s on no freeze at all). A card with no prerequisites is
  compared with no upgrades.
- Every run plays real lives (3, plus the build's extra lives), with bugs and
  power-up tokens on. The bot taps a freeze on the ball heading into a growing
  fence, draws as many fences at once as the build allows, and draws a
  fence-type card's type for **every** fence.
- Measured, pair by pair on the same map and seed: wins, lives lost per map,
  clear time (median, on runs both sides won) and overtime paid (on runs both
  sides won).
- **The noise floor.** The sim is chaotic: any change at all reshuffles every
  seed. Six placebo builds (balls 0.05% to 0.2% slower or faster) and the
  baseline are seven rolls of "no change"; each card is read against their
  mean, and noise is two standard deviations of their spread:
  **wins 4.2pp, lives 0.06 per map, clear time 2.8%, pay 4.3%**. "vs noise" is
  the card's largest metric as a multiple of that. Above 2x is clear, 1x to 2x
  weak.
- Context for conditional cards: map number and the map's own features, 3
  lives, 60h banked.

## Headline

| Verdict | Cards |
|---|---|
| Clear (over 2x the noise) | 20 |
| Weak (1x to 2x) | 26 |
| Within the noise | 55 |
| Identical in every run, though the bot plays what they act on | 7 |
| Not measurable by this bot | 37 |

- **The cards that change a map add a rule, not a number.** Of the 20 clear
  cards, the strongest are the fence types (Semaphore, Redeploy, Guardrail,
  Ice, Flare, Mutex), the first shield (Defensive Programming Junior: 0.69
  fewer lives lost per map, the largest effect on survival in the catalogue)
  and Cold Boot. The rest are economy (Technical Debt, Performance Bonus,
  Horizontal Scaling, now that the multiplier pays) and a handful of speed
  rungs at about 6-7%.
- **Most ladders stop mattering after their first rung.** The second and later
  shields add nothing measurable (the bot rarely takes two hits on one map);
  Ghost Protocol, Padded Estimate, Free Fall, Severance and Total Compensation
  are within the noise at every rung, and Deadline Extension at every rung but
  Principal B; Benefits Package's Senior and Principal never changed a single
  run.
- **The freeze line is weak, not dead.** With the bot tapping freezes, every
  freeze rung (Feature Freeze, Cascade, Cron Job, Hot Standby, Frozen Assets)
  lands between 0.5x and 1.9x the noise: none clearly, several just above it.
  That is the line the design write-up called closest to the Slay the Spire
  feeling, so it is the one most worth making stronger.

## Read these with care

- **The fence types are measured with the bot drawing that type for every
  fence**, which is not how a player uses them. Semaphore's -21pp wins is the
  bot locking single balls with a fence that only locks pairs; a player picks
  it for the right pocket. Ice, Flare and Redeploy read as slower clears
  because they build 30-40% slower and the bot never uses what they do in
  return (Redeploy's fling, for one). What is solid: these cards change the
  game a lot, in both directions.
- **Rung-on-rung is measured against the stack below**, which sometimes crosses
  families (Ghost Protocol Junior requires Defensive Programming Senior). The
  "On top of" column names what each card was compared with.
- The bot is a weak player (61% of these maps won) that cuts where it sees
  room. It measures how a card changes play, not how it feels.
- Cards measured as "identical" never changed a run on these maps: Code
  Review's 3% margin never decided a lock, the third and fourth shields were
  never used, Free Fall Principal B needs a gravity well these maps' rolls did
  not deal, and the later Benefits Package and Total Compensation B rungs never
  changed a token roll that mattered.

## Fixed along the way

- **Performance Bonus paid nothing** (`69dcdb8`): the score multiplier scaled
  only the 5h map base and was floored. It now scales the whole map pay; the
  sweep confirms Principal +10%, Technical Debt Principal +30%.
- **Bug ids were per session, not per map** (`3c86130`): a bug's magnitude is
  seeded by its id, so the same seed could deal different bugs depending on
  earlier play, which could split a Daily run between players or desync a
  pair.
- **The bot now plays the build the browser plays** (`7ba2036`): shields,
  Feature Freeze uses, Cold Boot, Cold Storage and Reliability at map start,
  Cron Job, the concurrent-fence limit and the banked-push payout are shared
  code now instead of living only in GameCanvas and the browser loop.

## Results

### Clear (more than 2x the noise)

| Card | On top of | Wins (pp) | Lives lost / map | Clear time | Pay | vs noise | Says |
|---|---|---|---|---|---|---|---|
| `raise_the_semaphore` | none | -20.9 | +0.30 | +38.2% | -24.8% | 13.9x | Adds the Semaphore fence: it locks only two or more balls at once, and pays past the map cap. |
| `rolling_redeploy` | none | +2.0 | +0.06 | +31.6% | +1.0% | 11.5x | Adds the Redeploy fence: grab it once and fling the balls in front of it. Builds 40% slower. |
| `defensive_programming_junior` | none | +2.4 | -0.69 | -0.8% | -3.5% | 10.8x | Each map starts with a shield that absorbs one ball hit for free. |
| `add_guardrails` | none | +0.8 | -0.69 | +4.8% | +2.4% | 10.7x | Adds the Guardrail fence: once a map, a ball through it costs the fence, not a life. 15% slower. |
| `technical_debt_principal` | `technical_debt_senior` | -0.5 | +0.01 | -2.7% | +30.2% | 7.0x | Earn 35% more overtime per map - but balls move 15% faster. |
| `cold_storage_ice` | none | +0.4 | +0.00 | +14.1% | -5.0% | 5.1x | Adds the Ice fence: balls bouncing off it lose speed. It builds 30% slower. |
| `cold_boot` | none | +0.8 | -0.05 | +11.9% | -4.2% | 4.3x | Every map starts frozen for 2s, each ball pointing where it goes. +0.25s per other freeze (max 4). |
| `incident_flare` | none | +2.0 | +0.01 | +11.8% | +6.4% | 4.3x | Adds the Flare fence: balls bouncing off it speed up. It builds 30% slower. |
| `technical_debt_senior` | `performance_bonus_junior` | +2.9 | -0.00 | -2.4% | +17.9% | 4.2x | 20% more overtime per map, but balls move 8% faster. Short-term gain, long-term pain. |
| `technical_debt_architect` | `technical_debt_principal` | +7.9 | -0.07 | -9.2% | +17.7% | 4.1x | +5h to this run's per-map overtime ceiling. Balls move 25% faster. |
| `acquire_the_mutex` | none | -3.8 | +0.04 | +10.2% | +14.9% | 3.7x | Adds the Mutex fence: it locks a pocket only when one ball is in it, and pays extra when it does. |
| `horizontal_scaling` | `rolling_redeploy` | +2.4 | -0.03 | -0.8% | +15.4% | 3.6x | Every lock counts as one more ball for the simultaneous-trap multiplier, on top of anything else. |
| `runtime_optimisation_junior` | none | -3.0 | +0.02 | +8.3% | -5.4% | 3.0x | Reduce ball speed by 5%. |
| `fast_compile_principal_b` | `fast_compile_senior` | +2.0 | -0.06 | -7.2% | -3.4% | 2.6x | Incremental Build: fences start 10% faster, +5% per fence finished this map. |
| `onboarding_principal_a` | `onboarding_senior` | +1.6 | -0.10 | -6.9% | +1.3% | 2.5x | Probation Waived: start with 16% of the board captured instead of 12%. |
| `runtime_optimisation_principal_a` | `runtime_optimisation_senior` | -3.4 | -0.01 | +6.9% | -5.3% | 2.5x | All balls move 15% slower. 2% slower again per other safety upgrade (max 4). |
| `performance_bonus_principal` | `performance_bonus_senior` | +2.4 | -0.03 | -0.8% | +10.2% | 2.4x | 15% more overtime per map. +4% per other bank upgrade (max 5). |
| `load_balancer_senior` | `runtime_optimisation_junior` | +7.4 | -0.15 | -0.8% | -2.7% | 2.3x | The map's fastest ball moves 10% slower. Only that one. |
| `runtime_optimisation_senior` | `runtime_optimisation_junior` | +3.7 | -0.08 | -5.8% | -0.6% | 2.1x | Reduce ball speed by 10%. |
| `deadline_extension_principal_b` | `deadline_extension_senior` | +2.4 | -0.03 | -0.8% | +9.0% | 2.1x | On maps with 3+ balls: +1s per ball on Ship Early windows, and 2.2x Tempo. |

### Weak (1x to 2x the noise)

| Card | On top of | Wins (pp) | Lives lost / map | Clear time | Pay | vs noise | Says |
|---|---|---|---|---|---|---|---|
| `hot_start_junior` | `fast_compile_senior` | +0.8 | -0.01 | -0.8% | -8.2% | 1.9x | First fence in each map generates instantly. |
| `cascade_freeze_principal` | `cascade_freeze_senior` | +2.4 | -0.08 | -0.8% | -8.1% | 1.9x | Freeze taps hold balls 2s longer. +0.5s per other freeze upgrade (max 4). |
| `multithreading_principal` | `fast_compile_senior` | +6.2 | -0.08 | -0.8% | -8.1% | 1.9x | Allow one additional fence to be in progress simultaneously. |
| `onboarding_junior` | none | +1.2 | -0.05 | -4.9% | -6.1% | 1.8x | Every map starts with 8% of the board already captured. |
| `hot_start_architect_b` | `hot_start_principal` | +2.4 | -0.02 | -0.8% | -6.7% | 1.6x | From level 20: two instant fences each map, and one more growing at a time. |
| `bug_squash_principal_b` | `bug_squash_senior` | +3.7 | -0.10 | -0.8% | -1.4% | 1.6x | Sticky Situation: odds stay at 8%, but a stuck ball stays put for 6s. |
| `load_balancer_architect_b` | `load_balancer_principal` | +4.5 | -0.08 | -0.8% | -6.5% | 1.5x | Autoscaling: 16%, and 1% more per 2 other safety upgrades (max 4). |
| `fast_compile_principal` | `fast_compile_senior` | -1.3 | -0.01 | -3.8% | -6.5% | 1.5x | Increase fence generation speed by 30%. |
| `bug_squash_principal_a` | `bug_squash_senior` | +2.4 | -0.10 | -0.8% | -5.3% | 1.5x | Splat Rate: squash odds rise to 12%, and a stuck ball stays put for 3.5s. |
| `fast_compile_senior` | `fast_compile_junior` | +2.0 | -0.04 | -3.9% | +3.9% | 1.4x | Increase fence generation speed by 20%. |
| `continuous_delivery` | `clean_release` | +2.0 | -0.03 | -3.8% | -1.2% | 1.4x | Each fence you complete speeds up the next one by 4% for the rest of the map. |
| `hot_start_architect` | `hot_start_principal` | +5.8 | -0.06 | -0.8% | -3.5% | 1.4x | First three fences in each map generate instantly. |
| `memory_footprint_principal` | `memory_footprint_senior` | +2.0 | -0.05 | -0.8% | -5.9% | 1.4x | Reduce ball size by 15%. |
| `memory_footprint_principal_b` | `memory_footprint_senior` | +0.8 | +0.01 | -0.8% | -5.6% | 1.3x | On maps with a mover, balls 5% smaller, and the lock threshold widens by 8. |
| `runtime_optimisation_principal_b` | `runtime_optimisation_senior` | -1.3 | -0.04 | +3.4% | -5.5% | 1.3x | Reduce ball speed by 5%, and one random ball runs 50% slower each map. |
| `hotfix_tripwire` | none | -0.5 | -0.00 | +0.5% | -5.4% | 1.3x | Adds the Tripwire fence: builds 40% faster, and the first ball to touch it breaks it. |
| `bug_squash_senior` | `bug_squash_junior` | +1.2 | -0.02 | +1.7% | -5.3% | 1.2x | Squash odds rise to 8%, and a stuck ball stays put for 3s. |
| `performance_bonus_senior` | `performance_bonus_junior` | +2.4 | -0.03 | -0.8% | +5.2% | 1.2x | Gain 10% more overtime per map. |
| `onboarding_principal_b` | `onboarding_senior` | +2.0 | -0.02 | -3.3% | -1.1% | 1.2x | Fast Track: 13% captured, and 1% more per 2 other tempo upgrades (max 5). |
| `cron_job_principal` | `cron_job_senior` | +4.1 | -0.05 | -0.8% | -4.7% | 1.1x | Scheduled freezes now hold a ball for 4s. |
| `cron_job_architect_b` | `cron_job_principal` | +1.2 | +0.02 | +3.0% | -3.2% | 1.1x | Watchdog Timer: scheduled freezes stay 4s, and every ball freezes briefly on spawn. |
| `frozen_assets_principal_b` | `frozen_assets_senior` | +4.5 | -0.06 | -0.8% | -0.7% | 1.1x | Cold Storage: frozen locks still pay double, and every freeze lasts 1s longer. |
| `feature_freeze_senior` | `feature_freeze_junior` | +4.5 | -0.06 | -0.8% | -0.7% | 1.1x | Your freeze now holds a ball for 2s. |
| `feature_freeze_principal_a` | `feature_freeze_senior` | -0.5 | -0.02 | -0.8% | -4.6% | 1.1x | Rapid: two freezes per map, 1s each. |
| `cascade_freeze_junior` | `feature_freeze_senior` | +3.7 | -0.02 | -0.8% | -4.4% | 1.0x | A single freeze tap now freezes the 2 nearest balls. |
| `chaos_engineering_principal_a` | `chaos_engineering_senior` | +3.3 | -0.04 | -0.8% | -4.4% | 1.0x | Fault Injection: shards are 40% more likely to carry a bomb. |

### Within the noise

| Card | On top of | Wins (pp) | Lives lost / map | Clear time | Pay | vs noise | Says |
|---|---|---|---|---|---|---|---|
| `feature_freeze_principal_b` | `feature_freeze_senior` | +4.1 | -0.06 | -0.8% | -2.1% | 1.0x | Deep freeze: one freeze per map, held for 3s. |
| `chaos_engineering_senior` | `chaos_engineering_junior` | +4.1 | -0.05 | -0.8% | -1.5% | 1.0x | Shards are 20% more likely to carry a bomb. |
| `feature_freeze_junior` | none | -1.3 | -0.06 | -0.8% | -3.1% | 1.0x | Tap a ball to freeze it for 1s. One freeze per map. |
| `breaking_change_principal` | `breaking_change_senior` | +2.4 | -0.03 | -0.8% | +4.1% | 1.0x | Write-Off: each object you smash compounds the demolition payout by 30%, not 15%. |
| `load_balancer_architect_a` | `load_balancer_principal` | +0.8 | +0.00 | -0.8% | -4.1% | 0.9x | Round Robin: the fastest ball is slowed 20% instead of 15%. |
| `load_balancer_principal` | `load_balancer_senior` | -3.8 | +0.05 | -0.8% | -0.5% | 0.9x | The fastest ball is slowed 15% instead of 10%. |
| `fast_compile_junior` | none | +1.2 | -0.05 | -0.8% | -3.9% | 0.9x | Increase fence generation speed by 10%. |
| `defensive_programming_senior` | `defensive_programming_junior` | +2.4 | -0.06 | -0.8% | -3.5% | 0.9x | One more shield at every map start. |
| `breaking_change_junior` | none | +3.7 | -0.04 | -0.8% | -3.5% | 0.9x | Destructibles need one less hit to break. |
| `cron_job_architect` | `cron_job_principal` | +0.8 | -0.02 | -0.8% | -3.8% | 0.9x | Scheduled freezes now hold a ball 5s. +0.4s per other freeze upgrade (max 4). |
| `chaos_engineering_junior` | none | +3.3 | -0.05 | -0.8% | -3.8% | 0.9x | Shards are 10% more likely to carry a bomb. |
| `onboarding_senior` | `onboarding_junior` | +2.4 | +0.02 | -0.8% | -3.7% | 0.9x | Start with 12% of the board captured instead of 8%. |
| `ghost_protocol_principal_a` | `ghost_protocol_senior` | +2.0 | -0.02 | -0.8% | -3.6% | 0.8x | Your fences now pass through balls for their first 0.2s. |
| `hot_standby` | `cron_job_principal` | +0.8 | -0.04 | -0.8% | -3.5% | 0.8x | One more freeze every map. |
| `technical_debt_architect_b` | `technical_debt_principal` | +2.4 | -0.03 | -0.8% | -3.5% | 0.8x | While you are on your last life, 2.6x the Tempo payout, and balls 15% bigger. |
| `ghost_protocol_junior` | `defensive_programming_senior` | +2.4 | -0.03 | -0.8% | -3.5% | 0.8x | A new fence passes through balls for the first 0.1s of its growth. |
| `ghost_protocol_senior` | `ghost_protocol_junior` | +2.4 | -0.03 | -0.8% | -3.5% | 0.8x | Your fences now pass through balls for their first 0.15s. |
| `chaos_engineering_principal_b` | `chaos_engineering_senior` | +2.9 | -0.03 | -0.8% | -3.5% | 0.8x | Game Day: every map with shards has at least 2 shard bombs, on top of the 20%. |
| `padded_estimate_senior` | `padded_estimate_junior` | +2.4 | -0.03 | -0.8% | -3.5% | 0.8x | Every map is scored against two extra fences of par. |
| `benefits_package_junior` | none | +2.4 | -0.03 | -0.8% | -3.5% | 0.8x | Power-up tokens appear slightly more often. |
| `total_compensation_principal` | `total_compensation_senior` | +2.4 | -0.03 | -0.8% | -3.4% | 0.8x | Peak perks: the splitter makes 3 balls; tokens pay a level higher at 5 other risk upgrades. |
| `memory_footprint_senior` | `memory_footprint_junior` | -0.1 | +0.04 | -2.2% | +1.4% | 0.8x | Reduce ball size by 10%. |
| `free_fall_principal` | `free_fall_senior` | +2.4 | -0.03 | -0.8% | -3.4% | 0.8x | Terminal Velocity: gravity locks pay 4x. +0.25x per other lock upgrade (max 4). |
| `total_compensation_senior` | `total_compensation_junior` | +2.4 | -0.03 | -0.8% | -3.4% | 0.8x | Power-up payouts rise again, and split balls slow down further. |
| `total_compensation_junior` | `benefits_package_principal` | +2.4 | -0.03 | -0.8% | -3.4% | 0.8x | Every power-up pays out better, and split balls come out slower. |
| `padded_estimate_principal_b` | `padded_estimate_senior` | +2.4 | -0.03 | -0.8% | -3.3% | 0.8x | Overdelivery: par stays at two extra fences, but beating par pays double. |
| `deadline_extension_principal` | `deadline_extension_senior` | +2.4 | -0.03 | -0.8% | -3.3% | 0.8x | Ship Early windows now last 6s longer per ball. |
| `padded_estimate_junior` | none | +2.4 | -0.03 | -0.8% | -3.2% | 0.8x | Every map is scored against one extra fence of par. |
| `padded_estimate_principal` | `padded_estimate_senior` | +2.4 | -0.03 | -0.8% | -3.2% | 0.7x | Sandbagging: +3 fences of par, 4 at 4 other tempo upgrades. |
| `breaking_change_principal_b` | `breaking_change_senior` | +2.4 | -0.03 | -0.8% | +3.1% | 0.7x | On breakable maps, smashing costs no lock multiplier and each break pays 15% more. |
| `free_fall_senior` | `free_fall_junior` | +2.4 | -0.03 | -0.8% | -3.1% | 0.7x | Gravity locks now pay triple. |
| `memory_footprint_junior` | none | -3.0 | -0.00 | +0.8% | +1.5% | 0.7x | Reduce ball size by 5%. |
| `free_fall_junior` | none | +2.4 | -0.03 | -0.8% | -3.1% | 0.7x | Under gravity, in a live well, or on a gravity map: locks pay double. |
| `deadline_extension_senior` | `deadline_extension_junior` | +2.4 | -0.03 | -0.8% | -3.0% | 0.7x | Ship Early windows now last 4s longer per ball. |
| `micro_manager_principal` | `runtime_optimisation_senior` | +1.2 | -0.03 | -0.8% | -3.0% | 0.7x | Each locked ball slows every ball by 1%, down to a 50% floor. |
| `cascade_freeze_principal_b` | `cascade_freeze_senior` | +2.9 | -0.03 | -0.8% | -2.9% | 0.7x | Rolling Blackout: freezes stay the same length, but you get two more taps per map. |
| `frozen_assets_principal` | `frozen_assets_senior` | +2.4 | -0.03 | -0.8% | -2.9% | 0.7x | Locking a frozen ball pays 3x the lock bonus. +0.25x per other lock upgrade (max 4). |
| `tech_evangelist` | `risk_appetite` | +2.4 | -0.03 | -0.8% | -2.9% | 0.7x | Space Optimization bonuses pay double. +8% per other risk upgrade (max 5). |
| `ghost_protocol_principal_b` | `ghost_protocol_senior` | +2.0 | -0.02 | -0.8% | -2.9% | 0.7x | On maps with 3+ balls, fences pass through balls for 0.25s. Elsewhere 0.15s. |
| `severance_package_principal_b` | `severance_package_senior` | +2.4 | -0.03 | -0.8% | -2.9% | 0.7x | On maps with a syntax highlighting area, +11 overtime for every superior lock. |
| `frozen_assets_senior` | `feature_freeze_junior` | +2.4 | -0.03 | -0.8% | -2.8% | 0.7x | Locking a ball while it is frozen pays double the lock bonus. |
| `bug_squash_junior` | none | +0.8 | -0.02 | -0.8% | +2.8% | 0.6x | Every wall hit has a 5% chance to squash the ball flat and stick it for 2s. |
| `hot_start_principal` | `hot_start_junior` | +2.0 | -0.04 | -0.8% | -1.5% | 0.6x | First two fences in each map generate instantly. |
| `cron_job_senior` | `feature_freeze_senior` | +2.0 | -0.04 | -0.8% | -0.8% | 0.6x | Every 10s, automatically freeze a random ball in place for 3s. |
| `performance_bonus_junior` | none | +2.4 | -0.03 | -0.8% | +1.2% | 0.6x | Gain 5% more overtime per map. |
| `performance_bonus_principal_b` | `performance_bonus_senior` | +2.4 | -0.03 | -0.8% | +1.2% | 0.6x | Stock Options: only 5% more overtime, but Space Optimization bonuses pay double. |
| `severance_package_junior` | none | +2.4 | -0.03 | -0.8% | +1.7% | 0.6x | Each lock pays 1 bonus hour, counted under the map cap. |
| `severance_package_senior` | `severance_package_junior` | +2.4 | -0.03 | -0.8% | +1.5% | 0.6x | Locked balls now pay 2 bonus overtime hours each. |
| `severance_package_principal_a` | `severance_package_senior` | +2.4 | -0.03 | -0.8% | +0.3% | 0.6x | Golden Handshake: every ball you lock away pays 3 bonus overtime hours. |
| `deadline_extension_junior` | `padded_estimate_junior` | +2.4 | -0.03 | -0.8% | -2.1% | 0.6x | Every Ship Early bonus window lasts 2s longer per ball on the map. |
| `ultrathreading_principal` | `multithreading_principal` | -0.9 | -0.00 | -0.8% | -2.1% | 0.5x | Draw one more fence at a time, and another at five other tempo upgrades. |
| `cascade_freeze_senior` | `cascade_freeze_junior` | +0.8 | -0.02 | -0.8% | -2.0% | 0.5x | A single freeze tap now freezes the 3 nearest balls. |
| `defensive_programming_architect_b` | `defensive_programming_principal` | -0.1 | +0.01 | -0.8% | +1.7% | 0.4x | Nanobots: on maps with 3 or more balls, balls are 25% smaller. |
| `knowledge_transfer_senior` | `severance_package_junior` | +1.6 | -0.02 | -0.8% | -1.5% | 0.4x | Each lock speeds fence generation 4% for the rest of the map. |
| `breaking_change_senior` | `breaking_change_junior` | +0.4 | -0.02 | -0.8% | -1.1% | 0.4x | Destructibles need one hit less, so most come apart on the first solid contact. |

### Identical in every run, though the bot plays what they act on

- `code_review` (on top of none): A pocket up to 3% over the lock limit still locks its ball.
- `free_fall_principal_b` (on top of `free_fall_senior`): On maps with a gravity well, the pull bends your ball half as hard.
- `defensive_programming_principal` (on top of `defensive_programming_senior`): One more shield again at every map start.
- `defensive_programming_architect_a` (on top of `defensive_programming_principal`): Bunker: two more shields at every map start.
- `benefits_package_senior` (on top of `benefits_package_junior`): Power-up tokens appear more often still.
- `benefits_package_principal` (on top of `benefits_package_senior`): Power-up tokens turn up much more often, more still per other risk upgrade (max 5).
- `total_compensation_principal_b` (on top of `total_compensation_senior`): Profit Sharing: perks stay a level lower, but tokens turn up far more often.

### Not measured: the bot cannot exercise them

- **acts in the store or across runs** (11): `golden_parachute`, `expense_account`, `procurement_junior`, `procurement_senior`, `procurement_principal`, `procurement_principal_b`, `talent_scout`, `open_source_contribution`, `system_architect`, `augmentation_wizard`, `release_train`
- **needs a purse or spending between maps** (10): `venture_capital_senior`, `venture_capital_principal`, `venture_capital_architect`, `venture_capital_architect_b`, `war_chest`, `budget_cycle_junior`, `budget_cycle_senior`, `budget_cycle_principal_a`, `budget_cycle_principal_b`, `clean_release`
- **only draws something** (5): `scrum_master_1`, `scrum_master_2`, `scrum_master_4`, `scrum_master_6`, `scrum_master_6_b`
- **extra lives, which carry across a run; one map never used up three** (4): `fault_tolerance_junior`, `fault_tolerance_senior`, `fault_tolerance_architect`, `benefits_package_principal_b`
- **needs holding an object (Control Freak), which the bot never does** (4): `control_freak_junior`, `control_freak_senior`, `control_freak_principal_a`, `control_freak_principal_b`
- **acts on push-your-luck, which the bot never takes** (2): `moonshot`, `risk_appetite`
- **needs lives already lost, and the bot starts each map on 3** (1): `fault_tolerance_architect_b`
