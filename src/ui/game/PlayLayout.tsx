/**
 * Where the play screen's canvas pieces sit (CANVAS_UI_PLAN.md stage 2).
 *
 * The board is not in here: it is its own WebGL canvas under the interface,
 * laid out by GameCanvas in the DOM space between a top spacer of
 * `topHeight` and a bottom spacer of the stack's height (GameScreen). This
 * draws the interface around and over it, in a fixed order:
 *
 *   region   overlays on the play region (the board and its gutters), given
 *            the region's box: everything that was `inset-0` of the DOM's
 *            play-region wrapper
 *   top      the top bar, at the top edge
 *   bottom   the bars and controls, at the bottom edge
 *   over     full-screen layers: modals, panels, the pause sheet
 */
import type { ReactNode } from "react";
import { View, useUiScreen } from "../kit/ui";

export interface PlayRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PlayLayout({ topHeight, top, bottom, region, over }: {
  topHeight: number;
  top: ReactNode;
  bottom: ReactNode;
  region: (r: PlayRegion) => ReactNode;
  over?: ReactNode;
}) {
  const screen = useUiScreen();
  const r: PlayRegion = { x: 0, y: topHeight, width: screen.width, height: Math.max(0, screen.height - topHeight) };
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
      {region(r)}
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width }}>{top}</View>
      <View layout={{ position: "absolute", left: 0, bottom: 0, width: screen.width }}>{bottom}</View>
      {over}
    </View>
  );
}
