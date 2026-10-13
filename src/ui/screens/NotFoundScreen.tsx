/**
 * NotFoundScreen - the 404 page, on the canvas like every other screen
 * (canvas port of pages/NotFound.tsx's DOM card).
 *
 * Only a mistyped or stale URL reaches it, so it says so and offers the way
 * home. Drawn in the redo's flat style (UI_REDO_PLAN.md): left-aligned, ink
 * heading, one primary button.
 */
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { ArcadeButton, Label, ROLE, TEXT, View, useUiScreen } from "../kit/ui";

export function NotFoundScreen({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const width = Math.min(360, screen.width - 48);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center" }}>
      <View layout={{ width, gap: 12 }}>
        <Label text="404" size={TEXT["4xl"]} font="display" weight="700" color={ROLE.ink} />
        <Label text={t("notFound.message")} size={TEXT.lg} color={ROLE.muted} wrap />
        <ArcadeButton variant="primary" icon={Home} text={t("notFound.returnHome")} onTap={onHome}
          layout={{ alignSelf: "stretch", marginTop: 8 }} label="not-found-home" />
      </View>
    </View>
  );
}
