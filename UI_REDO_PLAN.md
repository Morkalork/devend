# UI_REDO_PLAN.md

The redo of the menus and the between-map screens, on the canvas kit
(CANVAS_UI_PLAN.md). Status: **built** (phases 1 to 5).

## Why

Every menu and between-map screen centred everything, glowed everything, used
one rounded-outline box for buttons, cards, chips and panels alike, mixed three
typefaces, and split the time between two maps into four unrelated screens
(Level Complete, Store, a draft, the next map), each with its own header and its
own idea of where Continue sits.

## Decisions (made with the owner)

- **Direction B, "Pipeline".** A run is a CI pipeline. Everything between two
  maps is ONE screen: stages on a vertical rail, the current one open, the ones
  before and after visible. Left-aligned, flat panels, no glow; the only colour
  on a stage is what the colour means.
- **Typography: Oxanium** for display (headings, buttons, card titles, headline
  figures, the HUD), bundled at 500/600/700. **Michroma stays for the logo
  only** (`FONT.logo`). Body text and the ledger's monospace are unchanged.
- **Promotion becomes a stage**: Debrief -> Promotion (when due) -> Store ->
  next level. (Ascension was a full screen here; it has since been removed, and
  the last map now ends the run on the result screen.) Sprint Planning and
  Tenure come before the first map, so they stay separate screens and only get
  restyled (phase 4).

## What stays, whatever the screen

- The band colour per five levels: it is the accent, and the only colour that
  varies.
- **Gold means hours, red means a cost**, everywhere (`ROLE.hours`, `ROLE.cost`).
- Tap-and-hold explainers, the canvas kit and the Admin gallery.
- The game's vocabulary (sprints, overtime, tenure, "replaced by AI").

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Display face, colour roles (`ROLE` in theme.ts), kit pieces: `StageRail`, `Headline`, `Ledger`, `Ticket` (src/ui/kit/pipeline.tsx). Gallery samples `Pipeline-debrief`, `Pipeline-store`. | built |
| 2 | The between-map screen: one pipeline replacing LevelCompleteOverlay, UpgradeShop, CapstoneDraftScreen and ContinuePrompt as separate layouts. | built |
| 3 | Main menu, run result (win and loss), tap-to-start gate. | built |
| 4 | Meta screens: Certificates, Achievements, Records, Loadouts, Options, Tutorial, Music, Pair lobby, Sprint Planning, Tenure (Ascension, since removed). | built |
| 5 | Motion: the headline counts up, the rail slides between stages, nothing else moves on its own. | built |

## Build record

**Phase 1.** `FONT.display` is Oxanium (textStyle defaults it to 600, since
Michroma had one weight and most display labels never set one); `FONT.logo`
keeps Michroma for the game title. The draft cards' word spacing is measured
instead of a fixed share tuned for Michroma's wide space. `ROLE` holds the
pipeline's colour roles. The four pieces draw with no glow and take the band's
accent as a prop. Tests: src/test/canvas/pipeline.test.ts.

**Phase 2.** The kit went flat first: `ArcadeButton` lost its glow, ping
ring and shimmer, takes a small radius and fills only when it is the screen's
recommended action (`glow` or `shimmer` promotes a secondary button to
primary), and labels are sentence case. `COLOR`'s neutrals were remapped onto
the `ROLE` greys, so every screen moved with it.

The three stages stay three screens in the session's state machine (that logic
is tested and did not change), but each now draws inside `PipelineFrame`
(src/ui/screens/PipelineFrame.tsx): a "After level N" line, a horizontal
`StageStrip`, the stage's `Headline`, then its content, in a column capped at
560px. The strip is horizontal rather than the phase 1 rail because the store's
shelf is a full-width carousel; the frame has a `shelf` slot that runs edge to
edge for it. Which stages a map has is `BetweenMapPlan` (pipelineModel.ts),
built in useGameSession and frozen once the Debrief closes: picking the
Promotion sets the capstone, and a live plan would drop the Promotion from the
store's strip. Every Continue button names where it goes ("Choose your
promotion", "Open the store", "Start level 11", "Finish the run").

- Debrief (LevelCompleteOverlay): the map's hours are the headline, captioned
  with what the map could pay; the fold, the hold-to-explain rows, the totals
  and the certificates are unchanged in content. The totals are gold, because
  they are hours.
- Promotion (CapstoneDraftScreen): "Pick 1 of 3" over the perk cards.
- Store (UpgradeShop): the budget left after the current picks is the
  headline (it counts down as items are picked); the STORE title row is gone,
  the chips are left-aligned, the checkpoint banner is a flat panel.
- ContinuePrompt: a flat panel, the heart beside the title.

**Phase 3.** The main menu is left-aligned: the logo and tagline with the ball
beside them, the way into a run (Continue, New Game) as buttons with the
recommended one filled, and everything else as a list of rows with a chevron.
A first-time ring now goes round the filled Start Game instead of replacing
the fill. The run result leads with the outcome in its tone, then the banked
overtime as the headline, then the run's facts as a `Ledger`; the glow disc is
gone. The tap gate is the flat surface with a sentence-case prompt.

**Phase 4.** The meta screens share two headings, both rewritten in place:
`MenuHeading` (Certificates, Records, Loadouts, Options, Music) and
`DraftHeader` with `DraftFrame` (Sprint Planning, Tenure; Ascension was the third
until it was removed). Both are
left-aligned, 700 weight, ink, with the screen's colour on the icon only.
Achievements, Tutorial and the pair lobby set their own titles and were moved
onto the same roles. "Re-enable all tutorials" is a secondary button.

**Phase 5.** `Headline` counts a numeric value (`useCountTo`: up from 0 when
the stage opens, then to each new value); the Debrief keeps its own count-up,
timed with the total's. Under the strip, which stays put, each stage's content
slides in from the right (`Appear` gained `fromX`). Nothing else on these
screens moves on its own: the checkpoint banner stopped breathing.

Tests: src/test/canvas/pipelineModel.test.ts (the plan, the labels, the frame,
the motion), plus the existing screen tests. Gallery: `LevelCompleteOverlay-
storeOnly` and `LevelCompleteOverlay-last` show the strip without a Promotion
and on the last map.

**The store as a sprint board** (asked for after phase 5: "more like a ticket
management system like Jira or Azure DevOps, but better looking"). Each offer
is a ticket (`TicketCard`, shopParts.tsx): a stripe in the tier's colour down
the left edge, a type square with the upgrade's icon, a stable key hashed
from the upgrade id (`DEV-214`, storeBoardModel.ts), the tier as a priority
glyph, the title, the description, the tags as labels, a status lozenge (To
do, In sprint, Done, Blocked, Over capacity) and the price as the estimate in
gold. A blocked ticket names its blockers outright instead of behind its lock.
The ability slot is a ticket of its own type, coloured by the ability, where
it used to be an inverted card.

Above the backlog sits the `SprintPanel`: the overtime as the sprint's
capacity bar, committed hours filling it, and one line per committed ticket
that a tap takes back out. Selecting a ticket changes it in place (lozenge,
accent edge and ground), so nothing moves under the finger.

The backlog stays the one-ticket-at-a-time strip rather than a board of
columns. Testers asked for that strip when the shop showed five cards at once
(contentCopyBudget.test.ts), and a column board on a phone would bring the
wall of text back. Tests: src/test/canvas/storeBoard.test.ts.

**The pre-map Acceptance Criteria** are the map's own ticket
(`AcceptanceCriteriaModal`, src/ui/game): the store's ticket look with the band's
accent as the stripe, a key hashed from the map's id, "Level N" as the title and
the map's id as its branch, then the criteria as checklist rows under their
groups (a box for goals and optional items, a fork for "or", a red cross for
the failure conditions). It replaces the generic explainer card for this one
modal only, because it is the only explainer that is a list; the grouping is
`criteriaSections` in winConditions.ts, in the same order and with the same
empty-group rule as the text list. Gallery: `AcceptanceCriteriaModal` (every
group) and `AcceptanceCriteriaModal-plain`. Tests:
src/test/canvas/acceptanceCriteria.test.ts.

**The Debrief is that ticket, filled in** (asked for: "the very card shown
before the map, with the contents filled in ... without all of the other
overwhelming information", as a trial). The card moved into
`AcceptanceTicket` (src/ui/game), which the pre-map modal and the Debrief both
draw. Each criterion now carries a check (`CriterionCheck` in winConditions.ts:
its clause, the bonus area it names, the failures it warns of, or both halves
of a trade); `triggerLevelComplete` marks every one on the board as it was won
(`acceptanceMarks`, applyCut.ts), and GameScreen joins the marks to the words
the player read before the map, so the two cards cannot disagree. Marked, a
row is a green check (met, or a failure that did not happen, under the heading
"Failure, avoided") or a red cross (missed: a goal an "or" win skipped, a bonus
area not taken). The Debrief keeps the frame (the stage strip and the hours
headline every stage has) and the rare notices (push failed, a certificate, a
personal best), and drops the breakdown, the axes and the totals. Those are
kept whole behind Admin's **Full debrief** switch (`debriefMode.ts`, a display
setting, not a run flag), to compare and to bring back. Gallery:
`LevelCompleteOverlay-ticket`, `LevelCompleteOverlay-ticketMissed`. Tests:
src/test/canvas/ticketDebrief.test.ts.

**The failed screen too** ("do the same for the map failed screen"). A lost
life and the run-ending loss both show the same ticket under the failure's
headline, marked on the board as the map failed, in place of the "still
needed" lines; the warning glyph goes to make room, and the overlay waits 7s
instead of 4.2s before moving on (a tap still goes at once; the last life still
waits for a tap). The marks ride on the `MapFailure` (`criteriaMet`), attached
in GameCanvas where both loss callbacks leave the game, so every failure kind
gets them. The failures are never headed "avoided" here: the map did fail,
sometimes by a rule the list does not name (a ball into a growing fence on the
last life). The same Admin **Full debrief** switch brings the old lines back.
Gallery: `MapFailedOverlay-ticket`, `-ticketRunOver`, `-full`.

**Over the finished board, filling in** ("dismiss the end of map exploding
game board and instead just show the acceptance criteria modal on top of the
finished map with overlays, but it is important that the card content is
filled in one by one, even if quickly"). The board no longer shatters at the
end of a map, won or lost: the game asks `keepBoardAtEnd` before every
dissolve (a win, Bank & Continue, a failed push, the run's last life), and the
score debrief's boxes are held instead of fading. GameScreen stays mounted
under the card (its key now carries the level, so a skipped store still deals
the next map a fresh screen). The Debrief is a modal now, not a pipeline
stage: a light scrim over the board, the ticket opening with every row an
empty box as it was before the map, then each row marked in reading order
(`fillIn.ts`: 380ms for the card, 230ms a row; reduced motion marks them all
at once; a tap finishes it). Once full, the hours earned land in the key row's
corner (where a store ticket shows its estimate), the rare notices appear, and
the Continue button, named for the next stage. The failed screen fills in the
same way. Admin's **Full debrief** brings back the shatter and the old screens
together. Every win also gets its marks in GameCanvas now, whichever path won
it: Bank & Continue and a failed push used to arrive without them and fell
back to the full Debrief.
