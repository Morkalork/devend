/**
 * The play region's small counters, pinned to its top corners. They were
 * inline in GameScreen's render; here they are one canvas component. Inert:
 * they sit over the board's top edge and must never take a cut aimed there.
 *
 *  - Feature Freeze: tap-freezes left this map (the upgrade, or Runway's freeze).
 *  - Control Freak rations: the two Principal verbs are the only ones counted,
 *    because the brake and the crank are paid for with the finger (a hand on a
 *    mover is a hand not drawing a fence). Stacked under the freeze chip.
 *  - Fence budget / WIP Limit: completed fences left this map. Warns (amber)
 *    at 2 or fewer.
 *
 * Each dims at zero to signal "out". The caller passes null for a counter the
 * map does not have, and for all of them once the map is won.
 */
import { Fence, Grab, Snowflake, Unlink, type LucideIcon } from "lucide-react";
import { Icon, Label, RADIUS, TEXT, tint, useUiScreen } from "../kit/ui";
import { Inert } from "./boardParts";
import { cssHex } from "./fxModel";
import { playChipLayout, type ChipCount, type ChipId } from "./overlayModel";

interface Props {
  accentColor: string;
  /** Screen y of the play region's top. */
  top: number;
  freeze: ChipCount | null;
  derails: ChipCount | null;
  bands: ChipCount | null;
  fenceBudget: ChipCount | null;
}

const ICON: Record<ChipId, LucideIcon> = {
  freeze: Snowflake,
  derails: Unlink,
  bands: Grab,
  fenceBudget: Fence,
};

export function PlayChips({ accentColor, top, freeze, derails, bands, fenceBudget }: Props) {
  const screen = useUiScreen();
  const chips = playChipLayout({ accentColor, freeze, derails, bands, fenceBudget });
  if (chips.length === 0) return null;
  return (
    <Inert label="play-chips" layout={{ position: "absolute", left: 0, top, width: screen.width, height: 0 }}>
      {chips.map(chip => {
        const c = cssHex(chip.color);
        return (
          <Inert key={chip.id} label={`chip-${chip.id}`} alpha={chip.alpha} layout={{
            position: "absolute", top: chip.top, ...(chip.side === "right" ? { right: 8 } : { left: 8 }),
            flexDirection: "row", alignItems: "center", gap: 4, borderRadius: RADIUS.md,
            paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
            backgroundColor: tint(0x000a05, 0.7), borderWidth: 1, borderColor: tint(c, 0x44 / 255),
          }}>
            <Icon icon={ICON[chip.id]} size={14} color={c} />
            <Label text={chip.text} size={TEXT.sm} font="display" weight="700" color={c} />
          </Inert>
        );
      })}
    </Inert>
  );
}
