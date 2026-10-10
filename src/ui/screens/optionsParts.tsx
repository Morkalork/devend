/**
 * Controls the Options screen had as native inputs, rebuilt on the canvas: a
 * volume slider (`<input type="range">`) and the total-reset confirmation.
 */
import { useRef } from "react";
import type { FederatedPointerEvent } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { COLOR, Label, RADIUS, TEXT, View, tint, useUiScreen, type Layout } from "../kit/ui";
import { ArcadeButton } from "./welcomeParts";
import { sliderValueAt } from "./optionsModel";

export interface VolumeSliderProps {
  /** 0..1. */
  value: number;
  onChange: (v: number) => void;
  /** The finger (or mouse) let go: the DOM input's onPointerUp. */
  onRelease?: () => void;
  color: number;
  layout?: Layout;
}

/**
 * A 0..1 slider in 0.01 steps. The touch target is taller than the 6px track
 * so a thumb can find it. Pressing it stops the event there, so a drag on the
 * slider moves the value instead of scrolling the page under it.
 */
export function VolumeSlider({ value, onChange, onRelease, color, layout }: VolumeSliderProps) {
  const boxRef = useRef<LayoutContainer | null>(null);
  const dragging = useRef(false);
  const handlers = useRef({ onChange, onRelease });
  handlers.current = { onChange, onRelease };

  const setFrom = (e: FederatedPointerEvent) => {
    const box = boxRef.current;
    const width = box?.layout?.computedLayout.width ?? 0;
    if (!box || width <= 0) return;
    handlers.current.onChange(sliderValueAt(box.toLocal(e.global).x, width));
  };
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    handlers.current.onRelease?.();
  };

  const v = Math.max(0, Math.min(1, value));
  return (
    <layoutContainer
      ref={boxRef}
      layout={{ height: 28, justifyContent: "center", ...(layout ?? {}) }}
      eventMode="static"
      cursor="pointer"
      onPointerDown={(e: FederatedPointerEvent) => { e.stopPropagation(); dragging.current = true; setFrom(e); }}
      onGlobalPointerMove={(e: FederatedPointerEvent) => { if (dragging.current) setFrom(e); }}
      onPointerUp={end}
      onPointerUpOutside={end}
      onPointerCancel={end}
    >
      <View layout={{ height: 6, borderRadius: 3, backgroundColor: tint(COLOR.foreground, 0.15), flexDirection: "row" }}>
        <View layout={{ width: `${v * 100}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      {/* The thumb. */}
      <View layout={{
        position: "absolute", left: `${v * 100}%`, top: 6, marginLeft: -8,
        width: 16, height: 16, borderRadius: 8, backgroundColor: color,
      }} />
    </layoutContainer>
  );
}

export interface ConfirmDialogProps {
  title: string;
  body: string;
  cancelText: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The total-reset confirmation: a dim backdrop that does NOT close on a tap
 * (deleting everything is a decision to make, not to dismiss), a card, and
 * Cancel / Reset side by side.
 */
export function ConfirmDialog({ title, body, cancelText, confirmText, onCancel, onConfirm }: ConfirmDialogProps) {
  const screen = useUiScreen();
  return (
    <View
      layout={{
        position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
        alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: tint(COLOR.black, 0.5),
      }}
      zIndex={1000}
    >
      {/* A static box under the card so taps on the backdrop land on something
          and never fall through to the screen behind. */}
      <layoutContainer eventMode="static" layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} />
      <View layout={{
        width: Math.min(384, screen.width - 32), padding: 24, borderRadius: RADIUS.xl,
        backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
      }}>
        <Label text={title} size={TEXT.xl} font="display" weight="700" wrap layout={{ marginBottom: 16 }} />
        <Label text={body} size={TEXT.base} color={COLOR.mutedForeground} wrap layout={{ marginBottom: 24 }} />
        <View layout={{ flexDirection: "row", gap: 12 }}>
          <ArcadeButton text={cancelText} variant="secondary" onTap={onCancel} layout={{ flex: 1 }} />
          <ArcadeButton text={confirmText} variant="danger" onTap={onConfirm} layout={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}
