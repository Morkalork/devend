/**
 * OffersScreen: the Sprint Planning collection (SPRINT_PLANNING_PLAN.md).
 *
 * Every offer the run-start draft can deal, pool by pool, split into open and
 * locked; a locked one says what opens it. This is the long-term goal surface:
 * purely presentational, the unlock state lives in useMetaProgression
 * (metArchetypes) and the meta stats (highest level reached).
 *
 * Replaces the loadout gallery, whose curse + blessing bundles the offers
 * retired.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardList, Lock, Skull, Sparkles } from "lucide-react";
import type { OfferCatalogue, RunOffer } from "@/types/offer";
import type { OfferUnlockContext } from "@/lib/sprintOffers";
import { contentText } from "@/i18n/content";
import { Appear, COLOR, Icon, Label, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { MenuHeading } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import { offerCount, offerSections, unlockText } from "./offersModel";
import { cardAccent } from "./sprintModel";

interface OffersScreenProps {
  catalogue: OfferCatalogue;
  unlock: OfferUnlockContext;
  onBack: () => void;
  accentColor?: string;
}

/** The price's red and the upside's pale green. */
const PRICE = 0xff6b6b;
const PALE = 0xc8ffd8;
/** text-xs leading-relaxed. */
const RELAXED = Math.round(TEXT.xs * 1.625);

export function OffersScreen({ catalogue, unlock, onBack, accentColor = "#00ff88" }: OffersScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const sections = offerSections(catalogue, unlock);
  const { open, total } = offerCount(sections);

  const wide = screen.width >= 640;
  const pad = wide ? 24 : 16;
  // max-w-2xl inside the page's padding.
  const contentWidth = Math.min(672, screen.width - pad * 2);

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9), padding: pad }}>
      <Appear fromY={20} duration={0.5} layout={{ flex: 1, width: contentWidth, alignSelf: "center" }}>
        <View layout={{ flex: 1, alignItems: "center", gap: 24 }}>
          <MenuHeading icon={ClipboardList} iconColor={accent} text={t("offers.title")} size={wide ? TEXT["4xl"] : TEXT["3xl"]}
            letterSpacing={1.2} maxWidth={contentWidth} />

          <View layout={{
            alignItems: "center", paddingLeft: 24, paddingRight: 24, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.xl,
            borderWidth: 1, borderColor: tint(accent, 0x55 / 255), backgroundColor: tint(accent, 0x11 / 255),
          }}>
            <Label text={t("offers.open")} size={TEXT.xs} upper letterSpacing={0.6} color={PALE} alpha={0.75} layout={{ marginBottom: 4 }} />
            <Label text={`${open} / ${total}`} size={TEXT["3xl"]} font="display" weight="700" color={accent} />
          </View>

          <ScrollView layout={{ flex: 1, alignSelf: "stretch", gap: 24, paddingRight: 4 }}>
            {sections.map(section => (
              <OfferSectionView key={section.pool} title={t(`sprint.kind.${section.pool}`)} hint={t(`offers.poolHint.${section.pool}`)}>
                {section.unlocked.map((offer, i) => (
                  <Appear key={offer.id} delay={0.1 + i * 0.04}>
                    <OfferCard offer={offer} accentColor={cardAccent({ offer }, accentColor)} />
                  </Appear>
                ))}
                {section.locked.map((offer, i) => (
                  <Appear key={offer.id} delay={0.2 + i * 0.03}>
                    <View alpha={0.7} layout={{
                      padding: 16, borderRadius: RADIUS.lg, borderWidth: 1,
                      borderColor: tint(COLOR.muted, 0.3), backgroundColor: tint(COLOR.muted, 0.05),
                    }}>
                      <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                        <Icon icon={Lock} size={16} color={COLOR.mutedForeground} layout={{ marginTop: 2 }} />
                        <View layout={{ flex: 1 }}>
                          <Label text={contentText.offerName(t, offer)} size={TEXT.sm} font="display" weight="700" color={COLOR.mutedForeground} wrap />
                          <Label text={unlockText(t, offer.unlock)} size={TEXT.xs} color={COLOR.foreground} alpha={0.8} wrap layout={{ marginTop: 4 }} />
                        </View>
                      </View>
                    </View>
                  </Appear>
                ))}
              </OfferSectionView>
            ))}
          </ScrollView>

          <Appear fromY={20} delay={0.4}>
            <ArcadeButton variant="secondary" text={t("offers.back")} icon={ArrowLeft} onTap={onBack} />
          </Appear>
        </View>
      </Appear>
    </View>
  );
}

function OfferCard({ offer, accentColor }: { offer: RunOffer; accentColor: string }) {
  const { t } = useTranslation();
  const ink = hex(accentColor);
  return (
    <View layout={{ padding: 16, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: tint(ink, 0x44 / 255), backgroundColor: tint(COLOR.white, 0.04) }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View layout={{ flex: 1 }}>
          <Label text={contentText.offerName(t, offer)} size={TEXT.base} font="display" weight="700" color={ink} wrap />
        </View>
        {offer.tag && <TagChip tag={offer.tag} />}
      </View>
      <OfferLine icon={Sparkles} iconColor={ink} text={contentText.offerDesc(t, offer)} textColor={PALE} />
      {offer.priceText && (
        <View layout={{ marginTop: 8 }}>
          <OfferLine icon={Skull} iconColor={PRICE} text={contentText.offerPrice(t, offer)} textColor={PRICE} />
        </View>
      )}
    </View>
  );
}

function OfferSectionView({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <View>
      <Label text={title} size={TEXT.xs} font="display" weight="700" upper letterSpacing={1.2} color={COLOR.mutedForeground}
        layout={{ marginLeft: 4 }} />
      <Label text={hint} size={TEXT.xs} color={COLOR.mutedForeground} alpha={0.8} wrap layout={{ marginBottom: 8, marginLeft: 4, marginTop: 2 }} />
      <View layout={{ gap: 12 }}>{children}</View>
    </View>
  );
}

/** An upside or a price: its icon, then the wrapped sentence. */
function OfferLine({ icon, iconColor, text, textColor }: { icon: typeof Skull; iconColor: number; text: string; textColor: number }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Icon icon={icon} size={16} color={iconColor} layout={{ marginTop: 2 }} />
      <View layout={{ flex: 1 }}>
        <Label text={text} size={TEXT.xs} lineHeight={RELAXED} color={textColor} wrap />
      </View>
    </View>
  );
}
