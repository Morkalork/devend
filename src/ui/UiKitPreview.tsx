/**
 * Every toolkit piece at phone size, reachable from Admin (CANVAS_UI_PLAN.md
 * stage 1): the place to look at a change to the kit before any screen does.
 */
import { Fragment, useState } from "react";
import { Snowflake, Zap, Shield, ArrowLeft, LayoutGrid } from "lucide-react";
import { UiHost } from "./UiHost";
import { useViewportSize } from "./viewport";
import { UiScreenContext } from "./screen";
import { Gallery } from "./dev/Gallery";
import { useUiLayers } from "./layerStore";
import { COLOR, RADIUS, TEXT } from "./theme";
import {
  Appear, Button, HoldHint, Icon, Label, Modal, Pressable, ProgressBar, ScrollView, TextField, View, tint,
} from "./kit";

function Preview({ onClose, onGallery }: { onClose: () => void; onGallery: () => void }) {
  const screen = useViewportSize();
  const [taps, setTaps] = useState(0);
  const [held, setHeld] = useState(false);
  const [code, setCode] = useState("");
  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: COLOR.background, padding: 16, gap: 12 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button icon={ArrowLeft} text="Back" variant="ghost" onTap={onClose} />
        <Label text="Canvas UI kit" size={TEXT.xl} font="display" color={COLOR.primary} />
        <View layout={{ flex: 1 }} />
        <Button icon={LayoutGrid} text="Screens" variant="outline" size="sm" onTap={onGallery} />
      </View>
      <ScrollView layout={{ flex: 1, gap: 12 }}>
        <Appear fromY={12}>
          <View layout={{ padding: 16, gap: 8, borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderColor: COLOR.border, borderWidth: 1 }}>
            <Label text="Type" size={TEXT.xs} color={COLOR.mutedForeground} upper letterSpacing={1.5} />
            <Label text="Michroma display" font="display" size={TEXT.lg} />
            <Label text="Space Grotesk body text that wraps across the card width when it is long enough to need more than one line." wrap />
            <Label text="JetBrains Mono 0123456789" font="mono" color={COLOR.primary} />
            <View layout={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View layout={{ flex: 1 }}>
                <Label text="A single line far too long for its box, cut with an ellipsis" truncate />
              </View>
              <Label text="Levels 1-5" size={TEXT.xs} color={COLOR.mutedForeground} />
            </View>
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

/**
 * The layers filed while the preview is open: what the pieces on show put up
 * through <CanvasLayer> (an explainer, a detail sheet). Admin has no
 * CanvasUiRoot of its own, and the layers the game keeps filed from Index (the
 * tap-to-start gate and the rest) were there before it opened and stay out.
 */
function PreviewLayers() {
  const layers = useUiLayers();
  const [before] = useState(() => new Set(layers.map(l => l.id)));
  return <>{layers.filter(l => !before.has(l.id)).map(l => <Fragment key={l.id}>{l.node}</Fragment>)}</>;
}

/** Admin's look at the canvas interface: the kit's pieces, and every screen in the gallery. */
export function UiKitPreview({ onClose }: { onClose: () => void }) {
  const screen = useViewportSize();
  const [gallery, setGallery] = useState(false);
  return (
    <UiHost>
      <UiScreenContext.Provider value={screen}>
        {gallery
          ? <Gallery onBack={() => setGallery(false)} />
          : <Preview onClose={onClose} onGallery={() => setGallery(true)} />}
        <PreviewLayers />
      </UiScreenContext.Provider>
    </UiHost>
  );
}
