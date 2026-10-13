/**
 * The canvas interface's larger pieces: scrolling, modals, progress, text
 * entry and entrance animation. Built on core.tsx.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate } from "motion";
import type { LayoutContainer } from "@pixi/layout/components";
import { X, Info } from "lucide-react";
import { COLOR, RADIUS, ROLE, TEXT } from "../theme";
import { Icon, Label, Pressable, View, type Layout } from "./core";
import { tint } from "./style";
import { usePulse } from "./motion";

// ── ScrollView ─────────────────────────────────────────────────────────────

export interface ScrollViewProps {
  layout?: Layout;
  children?: ReactNode;
  /** Which way it scrolls. */
  direction?: "vertical" | "horizontal";
}

/**
 * A box whose content scrolls under a drag, with momentum and a rubber band at
 * the ends (@pixi/layout's trackpad). The content is laid out inside it as a
 * flex column (or row), exactly like an `overflow-y-auto` div.
 */
export function ScrollView({ layout, children, direction = "vertical" }: ScrollViewProps) {
  const vertical = direction === "vertical";
  return (
    <layoutContainer
      layout={{ overflow: "scroll", flexDirection: vertical ? "column" : "row", ...(layout ?? {}) }}
      // The trackpad listens on this box, so it must be a touch target.
      eventMode="static"
      trackpad={vertical ? { xConstrainPercent: -1, yConstrainPercent: 0.15 } : { yConstrainPercent: -1, xConstrainPercent: 0.15 }}
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
  /**
   * Draw the card as an opened ticket (the store's board, UI_REDO_PLAN.md):
   * flat, a small radius, the edge grey and a 4px stripe of this colour down
   * its left side. Unset, the card is the standard explainer card.
   */
  stripe?: number;
  /** Drawn in the title's place, beside the X (a ticket's key row). */
  heading?: ReactNode;
}

/**
 * The explainer modal every tap-and-hold opens (CLAUDE.md): a dim backdrop
 * that closes on a tap, a card with an X. Positioned absolutely over the whole
 * screen, so it can be dropped into any screen's tree.
 */
export function Modal({ screen, onClose, children, accent = COLOR.primary, title, maxWidth = 380, dismissable = true, stripe, heading }: ModalProps) {
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
        <Pressable pressedAlpha={1} layout={stripe === undefined ? {
          width, padding: 20, gap: 12, borderRadius: RADIUS.xl,
          backgroundColor: COLOR.card, borderColor: tint(accent, 0.5), borderWidth: 1,
        } : {
          width, flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
          backgroundColor: ROLE.raised, borderColor: ROLE.edge, borderWidth: 1,
        }}>
          {stripe !== undefined && <View layout={{ width: 4, backgroundColor: stripe }} />}
          <View layout={stripe === undefined ? { gap: 12 } : { flex: 1, padding: 18, gap: 12 }}>
            <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              {title !== undefined && (
                <View layout={{ flex: 1 }}>
                  <Label text={title} size={TEXT.lg} weight="700" font={stripe === undefined ? undefined : "display"}
                    color={stripe === undefined ? accent : ROLE.ink} wrap />
                </View>
              )}
              {title === undefined && <View layout={{ flex: 1 }}>{heading}</View>}
              <Pressable onTap={onClose} layout={{ padding: 4, borderRadius: RADIUS.md }} label="close">
                <Icon icon={X} size={18} color={COLOR.mutedForeground} />
              </Pressable>
            </View>
            {children}
          </View>
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
