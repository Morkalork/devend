# UI_REDO_PLAN.md

The redo of the menus and the between-map screens, on the canvas kit
(CANVAS_UI_PLAN.md). Status: **phase 1 built**; phases 2 to 5 to do.

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
  next level. **Ascension stays a full screen**: it ends a run and "retire or
  go again harder" is the biggest decision in the game. Sprint Planning and
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
| 2 | The between-map screen: one pipeline replacing LevelCompleteOverlay, UpgradeShop, CapstoneDraftScreen and ContinuePrompt as separate layouts. | to do |
| 3 | Main menu, run result (win and loss), tap-to-start gate. | to do |
| 4 | Meta screens: Certificates, Achievements, Records, Loadouts, Options, Tutorial, Music, Pair lobby, Sprint Planning, Tenure, Ascension. | to do |
| 5 | Motion: the headline counts up, the rail slides between stages, nothing else moves on its own. | to do |

## Build record

**Phase 1.** `FONT.display` is Oxanium (textStyle defaults it to 600, since
Michroma had one weight and most display labels never set one); `FONT.logo`
keeps Michroma for the game title. The draft cards' word spacing is measured
instead of a fixed share tuned for Michroma's wide space. `ROLE` holds the
pipeline's colour roles. The four pieces draw with no glow and take the band's
accent as a prop. Tests: src/test/canvas/pipeline.test.ts.
