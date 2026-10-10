# CANVAS_UI_PLAN.md

The plan for moving the whole game interface - everything except Admin - from
React DOM onto the canvas, so the game is one full-screen canvas the browser
has nothing to scroll, pan or resize under.

Status: **built** (stages 0 to 4, and the shell work of stage 5 that matters;
see section 9, the build record). Written after the eighth report of the board
zooming or shrinking while a fence is drawn.

---

## 1. Why, and what it will and will not fix

### The history

Eight commits since September have each closed one way the board ends up the
wrong size under a finger:

| Commit | What it closed |
|---|---|
| 0606d61 | two-finger pinch zoom |
| 8cd0f8d | double-tap zoom |
| b989448 | iOS one-finger drag-to-zoom near a recent tap |
| 27ae530 | the zoom that gets through anyway: notice it, try to undo it, pause the map (viewportZoom.ts) |
| 55aa30e | that pause waited for a lift a fence never gives |
| bb40c5a | a fence begun BESIDE the board was a page pan: the DOM around the canvas allowed pan |
| 88f7ebb | the board was resized, not zoomed: `100dvh` moved with the URL bar |
| 73db94e | the guard switched itself off over the play region (overflow measured as scrolling) |

The last four have one thing in common: **the boundary between the canvas and
the DOM around it.** The browser decides what a touch is from the element under
the finger at touchdown. A touch that lands on the DOM chrome (the top bar, the
margins, the gap above the ability bar) is handled by DOM rules (`touch-action`,
scrolling, viewport units, resize), and the game cannot take it back when the
finger crosses onto the board. Every fix so far has patched one of those DOM
rules. More DOM means more rules to patch.

### What one canvas fixes

- **No DOM boundary to cross.** Every touch lands on the canvas, which carries
  `touch-action: none`, so there is no "began beside the board" case left.
- **Nothing to scroll.** `html` and `body` become `position: fixed`,
  `overflow: hidden`, `overscroll-behavior: none`, `touch-action: none`. No
  element on a playing screen can be panned, so no pan can collapse the URL bar,
  and no URL-bar change can resize the layout. The scrolling the game actually
  needs (the fence-slot row, the shop list) is implemented on the canvas, where
  it is the game's gesture, not the browser's.
- **One layout.** The board's rectangle and the interface around it come from
  one layout pass in one coordinate space, so they cannot disagree, and a
  resize can be deferred until no finger is down in one place.

### What it does not fix

- **iOS's own zoom.** iOS Safari ignores `user-scalable=no` and does not let
  `touch-action` govern its accessibility zoom. A canvas is still a page.
  viewportZoom.ts (notice, undo, pause) stays as the backstop on every screen.
- **Anything not caused by the DOM.** If the current report is the iOS
  one-finger zoom on the canvas itself, moving the interface changes nothing.
  **That is why stage 0 measures first** (section 4): this is a large
  rewrite, and it should only start once we know the current zoom comes
  through the DOM.

---

## 2. What moves

About 19,000 lines across 70 components in `src/components/game`, plus the
screen router in `src/pages/Index.tsx` (831 lines). Admin
(`src/components/admin`, `MapBuilder`, `PlaygroundScreen`) stays in React DOM
and is reached by leaving the canvas screen.

| Group | Components (lines) | Notes |
|---|---|---|
| **Play HUD** (around the board while playing) | GameTopBar (411), TopBarDetailsPanel (622), GoalChip, ConditionChip, FenceSlotBar (248), AbilityBar, AbilityCountdownBar, GameMessageBar, ShipEarlyBar, PushExitBar, BossBanner, MapRuleBanner, BoardAlert, DeadlineFrame, WinGateFrame, PerfOverlay, LockDebugOverlay | The surface that matters for the zoom problem. FenceSlotBar has the one horizontal scroll on the play screen. |
| **Play overlays** (over the board) | RubberBandOverlay, LaunchOverlay, InteractiveTutorialOverlay, TutorialOverlay, TutorialArt, PairTurnOverlay, PairDecision, PairLinkBanner, BoardPlaceholder | Already positioned from `boardRect`, so they map onto canvas coordinates directly. |
| **Info modals** (tap-and-hold) | AbilityInfoModal, FenceTypeInfoModal, LockExplainerModal, SuperiorLockInfoModal, BoardEntityInfoModal, FeatureUnlockedModal, MapTuningModal | One modal component with a backdrop and an X covers all of them. MapTuningModal has inputs. |
| **Between maps** | LevelCompleteOverlay (794), ResultScreen (560), UpgradeShop (1383), RunDraftScreen, TenureDraftScreen, CapstoneDraftScreen, AscensionDraftScreen, DraftCard, Carousel, MapFailedOverlay, PushYourLuckOverlay, ContinuePrompt, ModifierBreakdown (671), PerformanceReviewAxes | The biggest screens; vertical scrolling and card carousels. |
| **Meta screens** | WelcomeScreen (623), OptionsScreen, TutorialScreen, AchievementsScreen, HallOfFameScreen, CertificateStore (597), JukeboxScreen, LoadoutGalleryScreen, PairLobby (700), TapToStartGate | OptionsScreen and PairLobby have text inputs. |
| **Backgrounds** | CRTBackground (569, DOM `<pre>` text), MemoryParallaxLayer (already a 2D canvas) | Become layers under everything on the one canvas. |
| **Shell** | GameScreen (1724), Index.tsx (831), GameErrorBoundary | Screen routing stays React state; only what it renders changes. |

**Not moving:** the hooks (`src/hooks`), the game logic (`src/lib`), i18n keys,
the YAML content. That is most of the code.

---

## 3. How: keep React, change what it renders to

The biggest decision. Two options:

**A. `@pixi/react` v8 (recommended).** A React renderer whose elements are Pixi
objects instead of DOM nodes. Every hook, manager, context and `useTranslation`
call keeps working, and each component keeps its state logic; what changes is
`<div className=...>` becoming a Pixi container with a layout, and text and
icons becoming Pixi text and sprites. The port is a translation of each
component's markup, not a rewrite of its behaviour. It needs **React 19**
(peer dependency `react >= 19`), so stage 1 starts by upgrading React 18 to 19
on its own, while everything is still DOM.

**B. Imperative Pixi**, the way the board renderer is written. Full control and
no React overhead per frame, but every screen's state handling is rewritten by
hand, and the hooks it relies on (session, upgrades, certificates, i18n) need
a second, non-React way in. Roughly twice the work of A, for a benefit (per-frame
control) that only the HUD's numbers need, and those can be imperative inside A.

### The toolkit (stage 1 builds this before any screen moves)

| Piece | Choice | Replaces |
|---|---|---|
| Layout | `@pixi/layout` v3 (Yoga, the flexbox engine React Native uses) | Tailwind flex/grid classes |
| Text | Pixi `Text` at device pixel ratio for prose; `BitmapText` for numbers that change every frame (score, timer, counts) | DOM text |
| Fonts | JetBrains Mono, Space Grotesk and Michroma, loaded with `document.fonts.load` before the first frame (TapToStartGate already waits for a tap) | `index.css` `@font-face` |
| Icons | the `lucide` package (same icons as `lucide-react`, plain SVG), drawn through Pixi's SVG support and cached as textures | `lucide-react` |
| Animation | `animate()` from the `motion` package (framer-motion's own engine, which animates plain values) | framer-motion components |
| Input | one pointer router on the canvas: hit-testing in layout order, and the gestures the game uses (tap, tap-and-hold at 450ms, drag, vertical and horizontal scroll with momentum) | DOM events, CSS `touch-action` |
| Scroll views | `@pixi/ui` ScrollBox, or a small own one if it fights the router | overflow scrolling |
| Text input | `@pixi/ui` Input, which focuses a hidden DOM input so the phone keyboard appears; used only on Options, Pair Lobby and Map Tuning, never on the play screen | `<input>` |
| Theme | the colour tokens from `index.css` and `palette.ts`, as one TypeScript table | CSS variables |

### One canvas

The board's Pixi application (SleekRenderer; ThreeRenderer shares its context)
becomes the full-screen application. The board is one view inside the layout,
and `boardRect` is that view's rectangle, produced by the same layout pass as
everything around it. GameCanvas's input keeps working, because it already
speaks `boardRect`; the router hands it every pointer that starts inside the
board view.

---

## 4. Stages

Each stage ships on its own; until a group is moved, its DOM version stays and
works. React DOM and the canvas coexist during the migration by rendering the
not-yet-moved DOM over the full-screen canvas, which is today's arrangement.

**Stage 0: measure the zoom (small, do first).** A recorder like the 3D
diagnostics card in Admin: every `visualViewport` scale or offset change, every
window `resize`, and every `boardRect` rebuild, each with the time, whether a
finger was down, and the element the touch started on. The next reproduction
tells us which mechanism it is. If the touch started on DOM, this plan is the
fix. If it started on the canvas, it is the iOS zoom: a targeted fix comes
first, and this plan is judged on its other merits.

**Stage 1: foundation.**
- React 19 upgrade, still all DOM, tests green.
- Add `@pixi/react`, `@pixi/layout`, `@pixi/ui`, `lucide`, `motion`.
- Build the toolkit above, a theme table, and a test page in Admin that shows
  every toolkit piece at phone size.
- Lock the page: fixed body, no scroll.

**Stage 2: the play screen (the one that fixes the zoom).**
- Every group in the Play HUD row of section 2, plus the play overlays and the
  info modals.
- GameScreen renders the board view and the HUD on the canvas.
- The fence-slot row scrolls on the canvas.
- **Checkpoint:** play it on a phone. If the zoom reports stop, stages 3 to 5
  are about consistency rather than bugs, and their order and timing are open.

**Stage 3: between maps.** Level complete, result, shop, drafts, failure, push
your luck. The shop is the largest single screen; its list becomes a scroll view
and its cards one reusable card component.

**Stage 4: meta screens.** Welcome, options, tutorial, achievements, hall of
fame, certificates, jukebox, loadouts, pair lobby, tap-to-start.

**Stage 5: shell.** Index.tsx renders the canvas application plus Admin's
route; Tailwind and framer-motion stay only for Admin. CRTBackground becomes a
canvas layer.

Rough size: stage 1 is a week-sized piece; stage 2 is the largest risk and
roughly a third of the component lines; stages 3 and 4 are each about the same
again, but mechanical once the toolkit exists.

---

## 5. Tests

- **74 test files** use Testing Library; **46** of those render game
  components and will stop working as those components move to Pixi.
- Each screen is split as it moves: a pure view model (what to show, enabled or
  not, which text key), tested like `src/lib` is today, and a Pixi view that
  only draws it. Most existing assertions move to the view model unchanged.
- Layout gets a headless check: build the Pixi tree without a GPU and assert
  rectangles (the HUD never overlaps the board, nothing runs off a 360px wide
  screen, Swedish and Spanish strings wrap instead of clipping).
- Playwright screenshots of every screen at phone size, in all three locales,
  the same way the 3D board was checked.

---

## 6. Conventions that change (CLAUDE.md)

- "framer-motion for animation, Tailwind utility classes, lucide-react for
  icons" becomes: the canvas toolkit, `motion`'s `animate()`, `lucide` icons
  drawn as textures. Admin keeps the old stack.
- i18n is unchanged: every string still comes from `react-i18next`, and all
  three locales still get every key.
- Tap-and-hold for explanations is a gesture in the router, so every element
  gets it the same way instead of each component wiring its own timer.

---

## 7. Risks

| Risk | What answers it |
|---|---|
| It does not fix the zoom (the zoom is not coming through the DOM) | Stage 0 measures before anything is built; the stage 2 checkpoint measures again |
| Text quality and speed on a phone: hundreds of `Text` objects in the shop | Text cached until its string changes, `BitmapText` for live numbers, the shop list virtualised (only visible cards exist) |
| Scrolling feels wrong (momentum, rubber band, nested scrolls) | One scroll implementation, tuned once on a real phone in stage 1, used everywhere |
| Accessibility: screen readers lose the DOM | Pixi's accessibility manager (focusable shadow elements, off until a screen reader or Tab key is used); a known regression, worth deciding explicitly |
| Keyboard: Android back button, desktop Tab and Enter | The router handles keys; back maps to the same action as the on-screen back control |
| `@pixi/react` v8 is young, and it needs React 19 | React 19 lands first, on its own; the stage 1 test page proves the toolkit before any screen depends on it; option B is the fallback |
| A long migration with two UI systems living side by side | Each stage ships; DOM and canvas coexist the way they do today; the play screen goes first because it is the one with the bug |

---

## 8. Decisions for the owner

1. **Run stage 0 first?** Recommended: it is small, and it decides whether this
   plan fixes the reported bug or is only a consistency project.
2. **Option A (`@pixi/react`, React 19) or B (imperative Pixi)?** A is
   recommended.
3. **Accessibility:** accept the screen-reader regression, or spend stage 1
   time on Pixi's accessibility layer?
4. **Stop after stage 2** if the zoom is gone, or carry on to every screen
   regardless?

---

## 9. Build record

Stages 0 to 4 shipped together, with the owner's go-ahead to do all of it in
one pass ("start with stage 0, then do the rest"). Decisions 1 and 2 above were
taken as recommended (stage 0 first; option A). Decision 3 was not asked and
defaults to accepting the screen-reader regression; decision 4 was answered by
the go-ahead: every screen moved.

### What was built, and where it differs from the plan

- **Stage 0.** `src/lib/zoomRecorder.ts` records every `visualViewport` and
  window resize and every board resize, with the finger state and the element
  a touch began on; Admin shows it (ZoomRecorderCard).
- **Stage 1.** React 19, `@pixi/react` 8, `@pixi/layout` 3, `motion`. The kit is
  `src/ui/kit` (View, Label, Icon, Pressable, Button, ScrollView, Modal, Appear,
  ProgressBar, TextField, HoldHint, the press and tween hooks); the theme is
  `src/ui/theme.ts`; Admin > Canvas UI kit shows every piece, and its Screens
  gallery draws every canvas screen, bar and modal with sample props.
- **One canvas, but not the board's.** The plan put the board inside the
  interface's Pixi application. It stayed its own WebGL canvas instead: the 3D
  and 2D renderers share a context and a fallback chain that a second owner
  would have complicated, and nothing in the zoom history needs them merged.
  The interface is one full-screen transparent canvas over everything
  (`CanvasUiRoot`), with `pointer-events: none`; Pixi listens on `<body>`, so
  every touch reaches both, and the board asks `uiCovers` (hitGate.ts) before
  starting a fence. The board keeps its DOM box, sized by two spacers whose
  heights come from `hudMetrics.ts`, the canvas HUD's own fixed heights, so the
  board sits exactly where it did.
- **Screens file their trees as layers.** A React portal cannot cross from
  react-dom into Pixi's renderer, so a screen hands its canvas tree to
  `<CanvasLayer id z lock>` (layerStore.ts) and the root draws every layer in
  z order. A layer's `lock` puts `canvas-ui` on `<html>` (fixed, no scroll, no
  overscroll, `touch-action: none`) while it is up; the admin Playground hosts
  the play screen unlocked, inside a `UiFrame` fitted to its pane.
- **Icons** are lucide-react components rasterised by the browser (Pixi's SVG
  parser rejects lucide's arc syntax), cached per icon, colour and size.
- **No `@pixi/ui`, no BitmapText.** Scroll views are @pixi/layout's trackpad;
  text entry is a hidden DOM input (TextField). Live numbers are plain Text;
  nothing measured needed BitmapText yet.
- **CRTBackground stays DOM**, drawn once under every canvas screen: it is
  decorative, takes no touches and so plays no part in the zoom problem.
- **Tests** follow section 5: each port moved its logic into a pure model
  (`*Model.ts`) and carried its behavioural tests into `src/test/canvas`; the
  source-reading HUD tests read the canvas files; `adminCoverage.test.ts`
  holds every rendered canvas piece to having a gallery entry.

### What bit, for whoever touches this next

- **Yoga twice.** Every `LayoutSystem.init` loads a fresh Yoga and makes it the
  global one, and StrictMode inits the application twice; boxes from the two
  instances refuse each other ("Expected null or instance of Node, got an
  instance of Node"). `setup.ts` keeps the first instance.
- **A box is a touch target by default** in @pixi/layout, so every tinted
  overlay would have eaten the cut under it: `<layoutContainer>` is passive
  unless it says otherwise.
- **Pixi's preventDefault on `<body>`** cancelled every DOM click on the page;
  it is off, and the page lock is CSS.
- **Positions taken from DOM boxes go stale under a transform.** The screen
  slide moves an element without resizing it; Index announces the end of the
  slide (`SCREEN_SETTLED_EVENT`) and `useScreenBox` re-reads then.
- **Text does not shrink or cut itself.** A single-line Label wider than its
  row overflows onto its neighbour; `wrap` or `truncate` anything whose length
  is not fixed. Most port bugs found in review were this.
- **A glow is drawn into the text's texture**, which Pixi sizes to the glyphs:
  without padding for the blur it is cut off in a hard box.

### Still open

- The real-phone checkpoint of stage 2: whether the zoom reports stop. The
  recorder in Admin is how to tell.
- The interface canvas renders every frame, on top of the board. Cheap on a
  desktop GPU; to be measured on a low-end phone with the perf overlay.

