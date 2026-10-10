/**
 * Every toolkit piece at phone size, reachable from Admin (CANVAS_UI_PLAN.md
 * stage 1): the place to look at a change to the kit before any screen does.
 */
import { useState } from "react";
import { Snowflake, Zap, Shield, ArrowLeft } from "lucide";
import { UiHost } from "./UiHost";
import { useViewportSize } from "./viewport";
import { COLOR, RADIUS, TEXT } from "./theme";
import {
  Appear, Button, HoldHint, Icon, Label, Modal, Pressable, ProgressBar, ScrollView, TextField, View, tint,
} from "./kit";

function Preview({ onClose }: { onClose: () => void }) {
  const screen = useViewportSize();
  const [taps, setTaps] = useState(0);
  const [held, setHeld] = useState(false);
  const [code, setCode] = useState("");
  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: COLOR.background, padding: 16, gap: 12 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button icon={ArrowLeft} text="Back" variant="ghost" onTap={onClose} />
        <Label text="Canvas UI kit" size={TEXT.xl} font="display" color={COLOR.primary} />
      </View>
      <ScrollView layout={{ flex: 1, gap: 12 }}>
        <Appear fromY={12}>
          <View layout={{ padding: 16, gap: 8, borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderColor: COLOR.border, borderWidth: 1 }}>
            <Label text="Type" size={TEXT.xs} color={COLOR.mutedForeground} upper letterSpacing={1.5} />
            <Label text="Michroma display" font="display" size={TEXT.lg} />
            <Label text="Space Grotesk body text that wraps across the card width when it is long enough to need more than one line." wrap />
            <Label text="JetBrains Mono 0123456789" font="mono" color={COLOR.primary} />
          </View>
        </Appear>
        <View layout={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Button text={`Tapped ${taps}`} onTap={() => setTaps(t => t + 1)} />
          <Button text="Outline" variant="outline" icon={Zap} />
          <Button text="Danger" variant="danger" />
          <Button text="Disabled" disabled />
        </View>
        <Pressable onTap={() => setTaps(t => t + 1)} onHold={() => setHeld(true)}
          layout={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.sky, 0.12), borderColor: tint(COLOR.sky, 0.5), borderWidth: 1 }}>
          <Icon icon={Snowflake} size={22} color={COLOR.sky} />
          <View layout={{ flex: 1 }}>
            <Label text="Tap, or hold to explain" color={COLOR.sky} weight="600" />
          </View>
          <HoldHint />
        </Pressable>
        <ProgressBar value={0.62} />
        <TextField id="kit-code" value={code} onChange={setCode} placeholder="ROOM CODE" upper maxLength={6} />
        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} layout={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: RADIUS.md, backgroundColor: COLOR.secondary }}>
            <Icon icon={Shield} size={16} color={COLOR.violet} />
            <Label text={`Scroll row ${i + 1}`} />
          </View>
        ))}
      </ScrollView>
      {held && (
        <Modal screen={screen} onClose={() => setHeld(false)} title="Hold to explain" accent={COLOR.sky}>
          <Label text="Every explainer opens like this: a hold of 450ms, a dim backdrop that closes on a tap, and an X." wrap color={COLOR.mutedForeground} />
        </Modal>
      )}
    </View>
  );
}

export function UiKitPreview({ onClose }: { onClose: () => void }) {
  return (
    <UiHost>
      <Preview onClose={onClose} />
    </UiHost>
  );
}
