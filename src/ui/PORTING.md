# Porting a DOM component to the canvas interface

The game's interface is moving from React DOM onto one full-screen Pixi
canvas (CANVAS_UI_PLAN.md). React stays: components keep their props, hooks,
state and `useTranslation`. What changes is what they render: Pixi objects laid
out with Yoga flexbox instead of `<div>`s styled with Tailwind.

`src/ui/game/PushExitBar.tsx` is a complete small example; read it next to
`src/components/game/PushExitBar.tsx`.

## The contract

- A DOM component `src/components/game/Foo.tsx` becomes `src/ui/<area>/Foo.tsx`
  exporting the same name with the **same props** (import the props type from
  the DOM file if it is exported; otherwise copy the interface verbatim, keeping
  its comments). Behaviour must not change: same i18n keys, same conditions,
  same callbacks at the same moments.
- Keep the DOM file's explanatory comments that still apply (shortened where
  they described DOM/CSS mechanics). The codebase is heavily commented on
  purpose; a port that drops the reasoning is a worse file.
- Kit gaps get fixed in the kit (`src/ui/kit`), once, rather than worked
  around in each screen; a helper only one area needs lives beside it
  (`src/ui/<area>/fooParts.tsx`).

## Import everything from one place

```ts
import { View, Label, Icon, Pressable, Button, ScrollView, Modal, ProgressBar,
  TextField, Appear, HoldHint, useTween, usePulse, usePress, tint, withAlpha,
  COLOR, FONT, RADIUS, TEXT, hex, useUiScreen } from "../kit/ui";
import { Snowflake } from "lucide-react";     // the same import as the DOM file
```

## The kit

| Piece | Use |
|---|---|
| `View layout={...}` | a `div`. Layout is Yoga flexbox: `flexDirection`, `gap`, `padding*`, `margin*`, `width`, `height`, `flex`, `alignItems`, `justifyContent`, `position: "absolute"` with `left/top/right/bottom`, plus `backgroundColor`, `borderColor`, `borderWidth`, `borderRadius`, `overflow: "hidden"`. Also `alpha`, `visible`, `zIndex`. |
| `Label text size color font weight wrap truncate align upper letterSpacing lineHeight glow alpha layout` | text. `truncate` is Tailwind's `truncate`: one line, cut with an ellipsis to the box's width. `font` is `"display"` (Michroma, Tailwind `font-display`), `"body"` (Space Grotesk, default), `"mono"`. `weight` is a string: `"700"` for `font-bold`. `upper` for `uppercase`. `glow` (px blur) for a text-shadow glow. |
| `Icon icon={LucideIcon} size color strokeWidth alpha` | an icon: pass the lucide-react component itself (so existing maps like `goalIcon()`, `upgradeIcon()`, the ability glyph table work as they are). `w-4 h-4` is `size={16}`. |
| `Pressable onTap onHold disabled layout pressedAlpha label` | anything clickable. Give it a `label` (what a screen reader would say; scripts and the gallery find controls by it). Disabled, it still swallows its taps, like a disabled DOM button. `onHold` is the game's 450ms tap-and-hold (CLAUDE.md). Moving the finger >10px cancels both, so a scroll that starts on it does not press it. |
| `Button text icon variant size tint onTap` | a standard button (`primary`, `outline`, `ghost`, `danger`, `secondary`). Use a `Pressable` when the DOM button was custom-styled. |
| `ScrollView direction layout` | `overflow-y-auto` / `overflow-x-auto`. Give it a bounded size (`flex: 1` in a column with a fixed-height parent, or a `height`). |
| `Modal screen onClose title accent maxWidth dismissable` | the backdrop + card + X used by every explainer. `screen` is `useUiScreen()`. |
| `ProgressBar value color track height` | a bar, `value` 0..1. |
| `TextField id value onChange placeholder upper maxLength inputMode onSubmit` | text entry (focuses a hidden DOM input for the keyboard). |
| `Appear fromY fromScale duration delay` | framer-motion's `initial -> animate` fade/slide/scale on mount. |
| `useTween(target, seconds)` | an animated number (count-ups, bars filling). |
| `usePulse(periodMs, enabled)` | 0..1 breathing value; `animate-pulse` is `alpha={0.6 + 0.4 * pulse}`. |
| `useUiScreen()` | `{ width, height }` of the screen in CSS px, for full-screen overlays. |

## Translating Tailwind

- Spacing: Tailwind unit = 4px. `p-4` = `padding: 16`, `px-3` = `paddingLeft: 12, paddingRight: 12`, `gap-2` = `gap: 8`, `mt-1.5` = `marginTop: 6`.
- Text sizes: `TEXT.xs` 12, `sm` 14, `base` 16, `lg` 18, `xl` 20, `2xl` 24, `3xl` 30, `4xl` 36. `text-[10px]` = `size={10}`.
- Radii: `RADIUS.base` 4 (`rounded`), `sm` 8, `md` 10, `lg` 12, `xl` 12, `2xl` 16, `full` 999.
- Colours are numbers. `accentColor` props arrive as `"#rrggbb"` strings: `hex(accentColor)`. A translucent colour (`${accent}55`, `bg-primary/10`, `rgba(0,10,5,0.85)`) is `tint(colorNumber, alpha)` (e.g. `tint(accent, 0x55 / 255)`, `tint(0x000a05, 0.85)`). Theme colours: `COLOR.primary`, `COLOR.card`, `COLOR.mutedForeground`, `COLOR.border`, `COLOR.destructive`, ...
- `flex` / `flex-row` on a div: `flexDirection: "row"` (**the default is column**, like a block div). `items-center` = `alignItems: "center"`, `justify-between` = `justifyContent: "space-between"`, `flex-1` = `flex: 1`, `flex-wrap` = `flexWrap: "wrap"`, `w-full` = `alignSelf: "stretch"` in a column (do not use `width: "100%"` for wrapped text; see below).
- `hidden` / conditional classes: render conditionally, or `visible={false}`.
- Shadows, blurs, gradients: approximate. A coloured `box-shadow` glow can be a `tint`ed border or dropped; `backdrop-filter: blur` is dropped; a gradient becomes its dominant colour, or a `pixiGraphics` drawing if it carries meaning.
- `transition-*`, `hover:*`, `active:scale-*`: dropped (Pressable already dims while pressed).
- `fixed inset-0` overlays: `View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}` with `const screen = useUiScreen()`.

## Layout rules that bite

1. Children stack in a **column** by default and **do not shrink** (`flexShrink: 0`). A row must say `flexDirection: "row"`. Something that should give way says `flex: 1` or `flexShrink: 1`.
2. **Wrapping text** (`<Label wrap />`) fills its parent's width. Its parent must have a definite width: a column (stretch gives it the width) or a `flex: 1` box inside a row. Never give a wrapped label `width: "100%"`.
3. Single-line text scales down to fit if its box is too small; give rows enough room or let text wrap.
4. `position: "absolute"` boxes are laid out against their parent's box; put them in a parent with a size.
5. Custom drawing: `<pixiGraphics draw={g => { g.clear(); g.circle(0, 0, 10).fill(color); }} />` inside a sized `View`. It does not take part in layout; it draws in the View's local coordinates from its top-left. Wrap the callback in `useCallback`.

## Interaction

- `onClick` -> `Pressable onTap`. A hold-to-explain (`onPointerDown` timers in the DOM) -> `onHold`; add a `HoldHint` (small Info icon) where the DOM had one.
- Hover handlers: drop them.
- Anything that sat over the board with `pointer-events-none` is a plain `View` (not a Pressable): it takes no touches and the board below gets them.
- The board ignores a touch that lands on any Pressable (ui/hitGate.ts), so an interactive overlay on the board is simply a Pressable.

## Board-space overlays

A DOM overlay positioned inside GameCanvas's container (using `canvasOffsetTop`,
`canvasOffsetLeft`, `canvasWidth`, `canvasHeight`, or `boardFrameCss`) takes one
extra prop, `origin: { x: number; y: number }`: the container's top-left in
screen CSS px. Add it to every position.

## Text and fonts

- `whitespace-nowrap` text: a plain `Label`. Paragraphs: `Label wrap`. `truncate`: `Label truncate`. A plain
  `Label` never shrinks or cuts itself, so one that can outgrow its row overflows onto its neighbours: wrap or
  truncate anything whose length you do not control (names, titles, translated strings).
- `tabular-nums`: `font="mono"` if alignment matters, otherwise ignore.
- `t('key', values)` unchanged. Never hardcode a user-facing string (CLAUDE.md:
  every string through i18n, no em-dashes in UI text).

## Logic and tests

- If the DOM component computes something non-trivial (which rows to show, a
  formatted value, a colour rule), move that into a pure function in a `.ts`
  file next to your component (e.g. `src/ui/game/fooModel.ts`) and import it.
- Find the tests that cover your DOM component:
  `grep -ln "components/game/Foo" src/test`. For each assertion that is about
  behaviour (what is shown, what a callback receives, a formatting rule), add an
  equivalent test against your pure function in `src/test/canvas/Foo.test.ts`.
  Assertions about DOM structure or CSS classes have no equivalent; skip them
  and list them in your report. Do not edit or delete the existing tests.

## Lint

`react-refresh/only-export-components`: a `.tsx` file exports only components
(and types). Hooks, constants and helpers go in a `.ts` file. CI caps the
warning count, so your files must produce **zero** warnings.

## Before you commit

```sh
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/ui/<your files>           # zero warnings: CI caps the total
npx vitest run src/test/canvas/<yours>
```

Then look at it: add the piece to the Admin screen gallery
(`src/ui/dev/gallery/<area>.tsx`) with realistic props and open it at phone
size (390x844 and 360x740). Most port bugs are only visible: text running into
its neighbour, an icon clipped, a page that cannot scroll to its last button.
