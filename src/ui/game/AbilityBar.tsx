/**
 * AbilityBar - the row of pressable ability buttons beneath the board (canvas
 * port of components/game/AbilityBar.tsx; #38).
 *
 * Abilities are earned by smashing treasure chests (and from the store); charges
 * bank run-wide. One button per ability the player has a charge of, in
 * catalogue order; the bar is empty, and takes no space, until the first one.
 *
 *  - Tap a button: use the ability (targeted ones, e.g. Magnet, ARM instead and
 *    the player then taps the board; the armed button is ringed).
 *  - Long-press (450ms): open an info modal explaining the ability.
 *  - The info modal also auto-opens ONCE the first time each ability is acquired.
 *
 * The DOM row wrapped onto more lines when full. Here it is ONE row, exactly
 * HUD.abilityRow tall, that scrolls sideways if it overflows: a row that grew
 * would move the board, which is laid out once against the HUD's height.
 */
import { useEffect, useRef, useState } from "react";
import { getAbility, type AbilityDef } from "@/lib/abilities";
import { hasSeenAbility, markAbilitySeen } from "@/lib/abilitySeen";
import { COLOR, Label, Pressable, RADIUS, ScrollView, TEXT, View, tint } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { AbilityInfoModal } from "./AbilityInfoModal";
import { AbilityIcon } from "./AbilityIcon";
import { ScreenOverlay } from "./bottomOverlay";
import { BlinkRing, GlowRing } from "./bottomParts";
import {
  abilityBarShape, abilityButtonLook, abilityPress, cssColor, gainedAbilityIds, ownedAbilities, TOUCH_TARGET,
} from "./bottomModel";

interface AbilityBarProps {
  /** Run-wide banked charges: { abilityId -> count }. */
  charges: Record<string, number>;
  accentColor: string;
  /** Fire (or arm, for targeted abilities) the ability. */
  onUse: (abilityId: string) => void;
  /** The ability currently armed and awaiting a board tap (targeted; e.g. Magnet). */
  armedAbilityId?: string | null;
  /** Signals when the info modal opens/closes, so the shell can pause the game. */
  onInfoOpenChange?: (open: boolean) => void;
}

export function AbilityBar({ charges, accentColor, onUse, armedAbilityId, onInfoOpenChange }: AbilityBarProps) {
  const owned = ownedAbilities(charges);

  // Blink an ability's button when its charge count RISES (a fresh grant or a
  // count-up, e.g. a just-tapped chest gem): easy to spot even in a full bar.
  // Keyed by a per-id nonce that bumps each gain so the flash replays.
  // Initialised from the first charges so a level start never blinks.
  const [blink, setBlink] = useState<Record<string, number>>({});
  const prevChargesRef = useRef<Record<string, number>>(charges);
  useEffect(() => {
    const gained = gainedAbilityIds(prevChargesRef.current, charges);
    prevChargesRef.current = charges;
    if (gained.length === 0) return;
    setBlink(b => { const n = { ...b }; for (const id of gained) n[id] = (n[id] ?? 0) + 1; return n; });
  }, [charges]);

  const [infoAbility, setInfoAbility] = useState<AbilityDef | null>(null);

  // First-acquire: auto-open the explainer once per ability the player owns and
  // hasn't been shown yet. Keyed on the owned-id set so it fires on a new grant.
  const ownedKey = owned.map(a => a.id).join(",");
  useEffect(() => {
    const fresh = owned.find(a => !hasSeenAbility(a.id));
    if (fresh) { markAbilitySeen(fresh.id); setInfoAbility(fresh); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey]);

  // Tell the shell whether the explainer is open, so it can pause the game while
  // a modal is up. Cleanup signals closed on unmount too.
  useEffect(() => {
    onInfoOpenChange?.(!!infoAbility);
    return () => onInfoOpenChange?.(false);
  }, [infoAbility, onInfoOpenChange]);

  const shape = abilityBarShape(owned.length, !!infoAbility);
  if (shape === "none") return null;

  return (
    <>
      {shape === "row" && (
        <ScrollView direction="horizontal" layout={{ height: HUD.abilityRow, alignSelf: "stretch", backgroundColor: tint(COLOR.black, 0.55) }}>
          {/* Auto margins: centred while it fits, from the left edge once it
              overflows (a centred overflowing row hides its first button). */}
          <View layout={{
            flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto", marginRight: "auto",
            paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
          }}>
            {owned.map(a => {
              const count = charges[a.id] ?? 0;
              const color = cssColor(a.color || accentColor);
              const look = abilityButtonLook(armedAbilityId === a.id);
              const press = abilityPress(a, onUse, ab => setInfoAbility(getAbility(ab.id) ?? ab));
              return (
                <Pressable
                  key={a.id}
                  label={a.name}
                  onTap={press.onTap}
                  onHold={press.onHold}
                  pressedAlpha={0.8}
                  layout={{
                    flexDirection: "row", alignItems: "center", gap: 6, height: TOUCH_TARGET,
                    paddingLeft: 12, paddingRight: 12, borderRadius: RADIUS.md,
                    borderWidth: 1, borderColor: color, backgroundColor: tint(color, look.fillAlpha),
                  }}
                >
                  {look.ring && <GlowRing color={color} />}
                  {blink[a.id] ? <BlinkRing key={`blink-${a.id}-${blink[a.id]}`} color={color} /> : null}
                  <AbilityIcon kind={a.kind} size={16} color={color} />
                  <Label text={a.name} size={TEXT.xs} weight="700" font="mono" color={color} />
                  <Label text={`x${count}`} size={TEXT.xs} weight="700" font="mono" color={color} alpha={0.75} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
      {infoAbility && (
        <ScreenOverlay>
          <AbilityInfoModal ability={infoAbility} onClose={() => setInfoAbility(null)} />
        </ScreenOverlay>
      )}
    </>
  );
}
