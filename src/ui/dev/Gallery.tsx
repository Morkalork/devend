/**
 * The canvas screen gallery: a list of every registered piece, and the chosen
 * one drawn full-screen with a Close button over it.
 */
import { useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, tint, useUiScreen } from "../kit/ui";
import type { GalleryEntry } from "./galleryTypes";
import { galleryEntries } from "./gallery";

const GROUPS: { id: GalleryEntry["group"]; title: string }[] = [
  { id: "play", title: "Play screen" },
  { id: "board", title: "Board overlays" },
  { id: "modal", title: "Modals" },
  { id: "screen", title: "Screens" },
];

export function Gallery({ onBack }: { onBack: () => void }) {
  const screen = useUiScreen();
  const [open, setOpen] = useState<GalleryEntry | null>(null);
  // Remounted on every open, so an entry's entrance animation plays again.
  const [epoch, setEpoch] = useState(0);
  if (open) {
    return (
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: COLOR.background }}>
        <View key={epoch} layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
          {open.render()}
        </View>
        {/* Drawn last, so it is over whatever the entry draws. */}
        <Pressable label="gallery-close" onTap={() => setOpen(null)} layout={{
          position: "absolute", right: 8, top: screen.height / 2 - 18, width: 36, height: 36, borderRadius: RADIUS.full,
          alignItems: "center", justifyContent: "center", backgroundColor: tint(COLOR.black, 0.6), borderWidth: 1, borderColor: COLOR.border,
        }}>
          <Icon icon={X} size={18} color={COLOR.foreground} />
        </Pressable>
      </View>
    );
  }
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: COLOR.background, padding: 16, gap: 12 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable label="gallery-back" onTap={onBack} layout={{ padding: 8 }}>
          <Icon icon={ArrowLeft} size={20} color={COLOR.foreground} />
        </Pressable>
        <Label text="Canvas screens" size={TEXT.xl} font="display" color={COLOR.primary} />
      </View>
      <ScrollView layout={{ flex: 1, gap: 6 }}>
        {GROUPS.map(g => (
          <View key={g.id} layout={{ gap: 6, marginBottom: 12 }}>
            <Label text={g.title} size={TEXT.xs} upper letterSpacing={1.5} color={COLOR.mutedForeground} />
            {galleryEntries.filter(e => e.group === g.id).map(e => (
              <Pressable key={e.id} label={e.id} onTap={() => { setEpoch(n => n + 1); setOpen(e); }} layout={{
                paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: RADIUS.md,
                backgroundColor: COLOR.secondary,
              }}>
                <Label text={e.id} size={TEXT.sm} />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
