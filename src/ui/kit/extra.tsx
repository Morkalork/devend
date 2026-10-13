/**
 * The canvas interface's larger pieces: scrolling, modals, progress, text
 * entry and entrance animation. Built on core.tsx.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Ticker, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import { useTick } from "@pixi/react";
import { animate } from "motion";
import type { LayoutContainer } from "@pixi/layout/components";
import { X, Info } from "lucide-react";
import { COLOR, RADIUS, TEXT } from "../theme";
import { Icon, Label, Pressable, View, type Layout } from "./core";
import { tint } from "./style";
import { usePulse } from "./motion";
import { beginPointer, claimPointer, claimedByOther, releasePointer } from "./gesture";
import {
  SCROLL_SLOP_PX, STOP_SPEED, clampScroll, isSettled, pruneSamples, releaseVelocity, rubberBand, scrollMin, stepScroll,
  type Sample, type ScrollMotion,
} from "./scrollModel";

// ── ScrollView ─────────────────────────────────────────────────────────────

export interface ScrollViewProps {
  layout?: Layout;
  children?: ReactNode;
  /** Which way it scrolls. */
  direction?: "vertical" | "horizontal";
}

/** The listeners @pixi/layout's own scroller puts on a scroll box (LayoutContainer's constructor). */
const LIBRARY_SCROLL_EVENTS = ["pointerdown", "pointerup", "pointerupoutside", "pointermove", "pointercancel", "wheel"] as const;

/** Yoga's edge indices (yoga-layout's Edge.Right / Edge.Bottom). */
const EDGE_RIGHT = 2;
const EDGE_BOTTOM = 3;

/** The box's size along the axis, and how far its laid-out content reaches. */
function measureScroll(box: LayoutContainer, vertical: boolean): { viewport: number; content: number } {
  const yoga = box.layout?.yoga;
  if (!yoga) {
    return { viewport: 0, content: 0 };
  }
  let reach = 0;
  for (let i = 0; i < yoga.getChildCount(); i++) {
    const child = yoga.getChild(i);
    const end = vertical
      ? child.getComputedTop() + child.getComputedHeight() + child.getComputedMargin(EDGE_BOTTOM)
      : child.getComputedLeft() + child.getComputedWidth() + child.getComputedMargin(EDGE_RIGHT);
    if (end > reach) {
      reach = end;
    }
  }
  const viewport = vertical ? yoga.getComputedHeight() : yoga.getComputedWidth();
  const content = reach + yoga.getComputedPadding(vertical ? EDGE_BOTTOM : EDGE_RIGHT);
  return { viewport, content };
}

/**
 * When the input happened, not when its handler ran: on a busy frame the moves
 * and the lift are handled back to back after it, and handler time would make a
 * flick look like a finger that had stopped.
 */
function inputTime(e: FederatedPointerEvent): number {
  const stamp = (e.nativeEvent as Event | undefined)?.timeStamp;
  return typeof stamp === "number" && stamp > 0 ? stamp : performance.now();
}

interface ScrollDrag {
  pointerId: number;
  /** Where the finger went down, along and across the axis. */
  startAxis: number;
  startCross: number;
  /** The content position the finger's travel is added to. */
  from: number;
  /** Past the slop along this axis, and the pointer is ours. */
  claimed: boolean;
  samples: Sample[];
}

/**
 * A box whose content scrolls under a drag, with momentum and a rubber band at
 * the ends, laid out inside it as a flex column (or row) exactly like an
 * `overflow-y-auto` div.
 *
 * Not @pixi/layout's built-in trackpad, which this replaced (and unhooks): it
 * counted its physics in frames, ran on a ticker of its own, stopped tracking
 * a finger that left the box, and took every drag whatever else wanted it - so the
 * store's page scrolled along with every swipe of the card strip inside it.
 * Here the drag is claimed (gesture.ts) only once it has travelled past the
 * slop along this box's axis, the physics run on elapsed time
 * (scrollModel.ts), and the step runs on the interface's own ticker, so the
 * content is placed in the frame that draws it.
 */
export function ScrollView({ layout, children, direction = "vertical" }: ScrollViewProps) {
  const vertical = direction === "vertical";
  const boxRef = useRef<LayoutContainer | null>(null);
  const owner = useRef(Symbol("ScrollView"));
  const motion = useRef<ScrollMotion>({ position: 0, velocity: 0 });
  const drag = useRef<ScrollDrag | null>(null);

  // The box stays `overflow: "scroll"`, because that is what tells Yoga to lay
  // the content out at its own size rather than squeeze it into the box (with
  // "hidden" the store's card strip collapsed to nothing). But "scroll" also
  // switches on @pixi/layout's built-in scroller, which would fight this one
  // for the content's position every frame: unhook it. Our handlers are the
  // `on...` properties @pixi/react sets, which removeAllListeners leaves alone.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    // Protected in its typings; the instance's own method is what the constructor registered.
    const libraryStep = (box as unknown as { update: () => void }).update;
    Ticker.shared.remove(libraryStep, box);
    for (const type of LIBRARY_SCROLL_EVENTS) {
      box.removeAllListeners(type);
    }
  }, []);

  const place = useCallback((position: number) => {
    motion.current.position = position;
    const box = boxRef.current;
    if (!box || box.destroyed) {
      return;
    }
    if (vertical) {
      box.overflowContainer.y = position;
    } else {
      box.overflowContainer.x = position;
    }
  }, [vertical]);

  // Released: let a fling run out, or pull back from past an end (which is
  // also where content that shrank under a resting page brings it back).
  useTick(useCallback((ticker: Ticker) => {
    const box = boxRef.current;
    if (!box || box.destroyed || drag.current?.claimed) {
      return;
    }
    const { viewport, content } = measureScroll(box, vertical);
    const min = scrollMin(viewport, content);
    if (isSettled(motion.current, min)) {
      return;
    }
    const next = stepScroll(motion.current, ticker.deltaMS, min);
    motion.current.velocity = next.velocity;
    place(next.position);
  }, [place, vertical]));

  const along = useCallback((e: FederatedPointerEvent) => (vertical ? e.global.y : e.global.x), [vertical]);
  const across = useCallback((e: FederatedPointerEvent) => (vertical ? e.global.x : e.global.y), [vertical]);

  const onPointerDown = useCallback((e: FederatedPointerEvent) => {
    const box = boxRef.current;
    if (!box || box.destroyed) {
      return;
    }
    beginPointer(e.pointerId, e.nativeEvent);
    const { viewport, content } = measureScroll(box, vertical);
    // Content that fits has nothing to scroll: stay out, so a scroller around
    // this one can take the drag.
    if (scrollMin(viewport, content) === 0 && motion.current.position === 0) {
      drag.current = null;
      return;
    }
    // A touch on a moving page catches it, as on a phone: the fling stops and
    // the touch is the page's, so the card under it does not take a tap.
    const catching = Math.abs(motion.current.velocity) > STOP_SPEED * 5;
    motion.current.velocity = 0;
    const claimed = catching && claimPointer(e.pointerId, owner.current);
    drag.current = {
      pointerId: e.pointerId,
      startAxis: along(e),
      startCross: across(e),
      from: motion.current.position,
      claimed,
      samples: [{ t: inputTime(e), position: motion.current.position }],
    };
  }, [along, across, vertical]);

  const onGlobalPointerMove = useCallback((e: FederatedPointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || e.pointerId !== d.pointerId || !box || box.destroyed) {
      return;
    }
    const travel = along(e) - d.startAxis;
    if (!d.claimed) {
      if (claimedByOther(e.pointerId, owner.current)) {
        drag.current = null;
        return;
      }
      const cross = across(e) - d.startCross;
      if (Math.hypot(travel, cross) < SCROLL_SLOP_PX) {
        return;
      }
      // Mostly across this axis: not ours (the card strip, or a scroller the other way).
      if (Math.abs(travel) < Math.abs(cross) || !claimPointer(e.pointerId, owner.current)) {
        drag.current = null;
        return;
      }
      d.claimed = true;
      // Follow from here, so the content does not jump by the slop.
      d.from = motion.current.position - travel;
    }
    const { viewport, content } = measureScroll(box, vertical);
    const position = rubberBand(d.from + travel, scrollMin(viewport, content), viewport);
    place(position);
    const now = inputTime(e);
    d.samples.push({ t: now, position });
    d.samples = pruneSamples(d.samples, now);
  }, [along, across, place, vertical]);

  const endDrag = useCallback((e: FederatedPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) {
      return;
    }
    drag.current = null;
    if (!d.claimed) {
      return;
    }
    releasePointer(e.pointerId, owner.current);
    motion.current.velocity = releaseVelocity(d.samples, inputTime(e));
  }, []);

  // A wheel or trackpad scrolls directly. One that cannot move this box (it
  // fits, or is at that end) is left to the box around it.
  const onWheel = useCallback((e: FederatedWheelEvent) => {
    const box = boxRef.current;
    if (!box || box.destroyed) {
      return;
    }
    const lines = e.deltaMode === 1 ? 16 : 1;
    const delta = (vertical ? e.deltaY : (e.deltaX || e.deltaY)) * lines;
    const { viewport, content } = measureScroll(box, vertical);
    const next = clampScroll(motion.current.position - delta, scrollMin(viewport, content));
    if (next === motion.current.position) {
      return;
    }
    motion.current.velocity = 0;
    place(next);
    e.stopPropagation();
  }, [place, vertical]);

  return (
    <layoutContainer
      ref={boxRef}
      layout={{ overflow: "scroll", flexDirection: vertical ? "column" : "row", ...(layout ?? {}) }}
      // The drag starts on this box (or bubbles to it), so it must be a touch target.
      eventMode="static"
      onPointerDown={onPointerDown}
      onGlobalPointerMove={onGlobalPointerMove}
      onPointerUp={endDrag}
      onPointerUpOutside={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      {children}
    </layoutContainer>
  );
}

// ── Appear ─────────────────────────────────────────────────────────────────

export interface AppearProps {
  children?: ReactNode;
  layout?: Layout;
  /** Start offset in px (slides in from below when positive). */
  fromY?: number;
  /** Start offset in px (slides in from the right when positive). */
  fromX?: number;
  fromScale?: number;
  duration?: number;
  delay?: number;
}

/** Fades (and optionally slides or scales) its content in on mount: framer-motion's `initial` -> `animate`. */
export function Appear({ children, layout, fromY = 0, fromX = 0, fromScale = 1, duration = 0.25, delay = 0 }: AppearProps) {
  const ref = useRef<LayoutContainer | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.alpha = 0;
    const controls = animate(0, 1, {
      duration, delay, ease: "easeOut",
      onUpdate: (t: number) => {
        if (node.destroyed) return;
        node.alpha = t;
        // `y`, not pivot: @pixi/layout builds the transform from the layout
        // position plus `position`, and ignores pivot.
        node.y = fromY * (1 - t);
        node.x = fromX * (1 - t);
        const s = fromScale + (1 - fromScale) * t;
        node.scale.set(s);
      },
    });
    return () => controls.stop();
  }, [duration, delay, fromY, fromX, fromScale]);
  return (
    <layoutContainer ref={ref} layout={layout ?? {}}>
      {children}
    </layoutContainer>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export interface ModalProps {
  /** The full screen the backdrop covers, in CSS px. */
  screen: { width: number; height: number };
  onClose: () => void;
  children?: ReactNode;
  /** The card's accent (border, close button). */
  accent?: number;
  title?: string;
  /** Card width cap; it never runs closer than 16px to the screen edge. */
  maxWidth?: number;
  /** Close on a backdrop tap (the game's standard; off for a decision that must be made). */
  dismissable?: boolean;
}

/**
 * The explainer modal every tap-and-hold opens (CLAUDE.md): a dim backdrop
 * that closes on a tap, a card with an X. Positioned absolutely over the whole
 * screen, so it can be dropped into any screen's tree.
 */
export function Modal({ screen, onClose, children, accent = COLOR.primary, title, maxWidth = 380, dismissable = true }: ModalProps) {
  const width = Math.min(maxWidth, screen.width - 32);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center" }} zIndex={1000}>
      <Pressable
        onTap={dismissable ? onClose : undefined}
        pressedAlpha={1}
        layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.7) }}
      />
      <Appear fromScale={0.94} duration={0.18}>
        {/* A Pressable with no handlers: it is interactive, so a tap on the
            card stops here instead of falling through to the backdrop, which
            would close the modal. */}
        <Pressable pressedAlpha={1} layout={{
          width, padding: 20, gap: 12, borderRadius: RADIUS.xl,
          backgroundColor: COLOR.card, borderColor: tint(accent, 0.5), borderWidth: 1,
        }}>
          <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            {title !== undefined && (
              <View layout={{ flex: 1 }}>
                <Label text={title} size={TEXT.lg} weight="700" color={accent} wrap />
              </View>
            )}
            {title === undefined && <View layout={{ flex: 1 }} />}
            <Pressable onTap={onClose} layout={{ padding: 4, borderRadius: RADIUS.md }} label="close">
              <Icon icon={X} size={18} color={COLOR.mutedForeground} />
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Appear>
    </View>
  );
}

/** The small "this can be held" hint the convention asks for. */
export function HoldHint({ color = COLOR.mutedForeground, size = 12 }: { color?: number; size?: number }) {
  return <Icon icon={Info} size={size} color={color} alpha={0.8} />;
}

// ── ProgressBar ────────────────────────────────────────────────────────────

export interface ProgressBarProps {
  value: number;
  color?: number;
  track?: number | string;
  height?: number;
  layout?: Layout;
}

export function ProgressBar({ value, color = COLOR.primary, track = tint(COLOR.foreground, 0.1), height = 6, layout }: ProgressBarProps) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View layout={{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden", flexDirection: "row", ...(layout ?? {}) }}>
      <View layout={{ width: `${v * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

// ── TextField ──────────────────────────────────────────────────────────────

export interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Upper-case what is typed (room codes). */
  upper?: boolean;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal";
  onSubmit?: () => void;
  layout?: Layout;
  id: string;
}

/**
 * Text entry on the canvas. A phone only shows its keyboard for a focused DOM
 * input, so a tap focuses a hidden one that receives the typing, and the
 * canvas draws its value. The input sits off-screen and is never under a
 * finger: it exists for the keyboard, not for touch.
 */
export function TextField({ value, onChange, placeholder, upper, maxLength, inputMode = "text", onSubmit, layout, id }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handlers = useRef({ onChange, onSubmit });
  handlers.current = { onChange, onSubmit };

  useEffect(() => {
    const input = document.createElement("input");
    input.id = id;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", upper ? "characters" : "off");
    input.inputMode = inputMode;
    if (maxLength) input.maxLength = maxLength;
    Object.assign(input.style, { position: "fixed", left: "-1000px", top: "0", opacity: "0", width: "1px", height: "1px" });
    input.addEventListener("input", () => {
      const v = upper ? input.value.toUpperCase() : input.value;
      handlers.current.onChange(v);
    });
    input.addEventListener("focus", () => setFocused(true));
    input.addEventListener("blur", () => setFocused(false));
    input.addEventListener("keydown", e => { if (e.key === "Enter") { handlers.current.onSubmit?.(); input.blur(); } });
    document.body.appendChild(input);
    inputRef.current = input;
    return () => { input.remove(); inputRef.current = null; };
  }, [id, upper, maxLength, inputMode]);

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== value) inputRef.current.value = value;
  }, [value]);

  const caret = usePulse(1000, focused) > 0.5 ? "|" : " ";
  const shown = value.length > 0 ? value + (focused ? caret : "") : (focused ? caret : placeholder ?? "");
  return (
    <Pressable
      onTap={() => inputRef.current?.focus()}
      pressedAlpha={1}
      layout={{
        paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: RADIUS.lg,
        backgroundColor: COLOR.background, borderWidth: 1,
        borderColor: focused ? COLOR.primary : COLOR.border, ...(layout ?? {}),
      }}
    >
      <Label text={shown} size={TEXT.base} font="mono" color={value.length > 0 ? COLOR.foreground : COLOR.mutedForeground} />
    </Pressable>
  );
}
