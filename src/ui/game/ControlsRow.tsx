/**
 * The play screen's control row: Menu, Pause/Play, Specs and Win, with the
 * popup menu above them (canvas port of the row GameScreen.tsx wrote inline).
 *
 * Every control the map has, in one place, in the thumb zone. These used to
 * float at top-left at 32px, on top of the status bar, while abilities sat at
 * the bottom - four homes for one category of thing, which is why nothing could
 * be found. Exactly HUD.controlsRow tall; every target is at least 44px.
 *
 * The menu opens UPWARD, since the row lives at the bottom of the screen. The
 * DOM closed it on any pointerdown outside the row and the menu; here, while
 * it is open, a transparent full-screen catcher sits behind the row and the
 * popup and closes it on a tap. Taps on the row itself (its buttons, and the
 * gaps between them) still land on the row, as they did in the DOM.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LayoutContainer } from "@pixi/layout/components";
import { Icon, Label, Pressable, RADIUS, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { useScreenOrigin } from "./bottomHooks";
import {
  controlButtons, menuItems, specsBadgeLabel, CONTROL_TARGET, MENU_GAP,
  type ControlText, type ControlsRowProps,
} from "./ControlsRowModel";

export type { ControlsRowProps };

/** The dark fill behind an idle control (`rgba(0,10,5,0.85)`). */
const IDLE_FILL = tint(0x000a05, 0.85);
/** The badge's dark ink on the accent. */
const BADGE_INK = 0x04160d;

export function ControlsRow(p: ControlsRowProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(p.accentColor);
  const text = (c: ControlText) => ("literal" in c ? c.literal : t(c.key, c.values));

  // Where the row is on screen, so the tap-outside catcher (positioned against
  // the row) can cover the whole screen. Until it is measured, assume the row
  // sits at the bottom edge, which is where the stack puts it.
  const rowRef = useRef<LayoutContainer | null>(null);
  const origin = useScreenOrigin(rowRef, p.menuOpen, { x: 0, y: screen.height - HUD.controlsRow });

  return (
    <layoutContainer ref={rowRef} layout={{
      height: HUD.controlsRow, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 8,
    }}>
      {p.menuOpen && (
        <>
          {/* Drawn first, so the row's buttons and the popup sit above it. */}
          <Pressable
            label="menu-dismiss"
            onTap={p.onCloseMenu}
            pressedAlpha={1}
            layout={{ position: "absolute", left: -origin.x, top: -origin.y, width: screen.width, height: screen.height }}
          />
          {/* The row's own box takes a tap in its gaps without closing, as
              taps inside the DOM row's ref did. */}
          <View layout={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
        </>
      )}

      {controlButtons(p).map(b => (
        <Pressable
          key={b.id}
          label={text(b.label)}
          onTap={b.onTap}
          layout={{
            minWidth: CONTROL_TARGET, minHeight: CONTROL_TARGET, alignItems: "center", justifyContent: "center",
            borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(accent, 0x55 / 255),
            backgroundColor: b.active ? tint(accent, 0x33 / 255) : IDLE_FILL,
          }}
        >
          <Icon icon={b.icon} size={b.iconSize} color={accent} strokeWidth={b.strokeWidth} />
          {b.badge !== null && (
            <View
              label={text(specsBadgeLabel(b.badge))}
              layout={{
                position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, paddingLeft: 4, paddingRight: 4,
                borderRadius: RADIUS.full, backgroundColor: accent, alignItems: "center", justifyContent: "center",
              }}
            >
              <Label text={String(b.badge)} size={10} weight="700" color={BADGE_INK} />
            </View>
          )}
        </Pressable>
      ))}

      {p.menuOpen && (
        <View layout={{
          position: "absolute", left: 0, bottom: HUD.controlsRow + MENU_GAP, minWidth: 180,
          borderRadius: RADIUS.lg, overflow: "hidden",
          backgroundColor: tint(0x000f08, 0.95), borderWidth: 1, borderColor: tint(accent, 0x55 / 255),
        }}>
          {menuItems(p).map(item => {
            const color = item.color ?? accent;
            return (
              <Pressable
                key={item.id}
                label={text(item.text)}
                onTap={item.onTap}
                layout={{
                  flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch",
                  minHeight: CONTROL_TARGET, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                }}
              >
                <Icon icon={item.icon} size={16} color={color} />
                <Label text={text(item.text)} size={TEXT.sm} weight="700" color={color} />
              </Pressable>
            );
          })}
        </View>
      )}
    </layoutContainer>
  );
}
