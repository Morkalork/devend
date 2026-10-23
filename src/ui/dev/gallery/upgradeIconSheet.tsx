/**
 * The upgrade icon sheet (Admin > Canvas UI kit > Screens > UpgradeIcons):
 * every upgrade package beside its glyph, drawn in the store ticket's own
 * type square, so a new or changed icon can be judged against all the others
 * at the size the player sees it. The rules live in upgradeIcons.ts; this is
 * where a glyph that breaks them is looked at.
 *
 * A package whose key is missing from the registry shows an empty square and
 * is named in red; two packages sharing a glyph are both named in red. The
 * ability glyphs and the priority glyphs are listed at the end, because the
 * rules forbid an upgrade from reusing those too.
 */
import yaml from "js-yaml";
import { ChevronDown, ChevronUp, ChevronsUp, Equal, Flame } from "lucide-react";
import upgradesYamlRaw from "../../../../public/upgrades.yml?raw";
import abilitiesYamlRaw from "../../../../public/abilities.yml?raw";
import type { UpgradeConfig } from "@/types/upgrade";
import { UPGRADE_ICONS, getUpgradeIcon, upgradeIconKey } from "@/components/game/upgradeIcons";
import { abilityGlyph } from "../../game/bottomModel";
import { schoolColor } from "../../screens/shopModel";
import { COLOR, Icon, Label, ROLE, ScrollView, TEXT, View, tint, type IconSource } from "../../kit/ui";

const upgrades = (yaml.load(upgradesYamlRaw) as { upgrades: UpgradeConfig[] }).upgrades;
const abilities = (yaml.load(abilitiesYamlRaw) as { abilities: { id: string; name: string; kind: string }[] }).abilities;

/** One row per package: its first tier, which is the one that names the icon. */
function packages(): UpgradeConfig[] {
  const seen = new Set<string>();
  const out: UpgradeConfig[] = [];
  for (const u of upgrades) {
    if (!seen.has(u.name)) {
      seen.add(u.name);
      out.push(u);
    }
  }
  return out;
}

const RED = 0xff6b6b;

function Square({ icon, color }: { icon: IconSource | null; color: number }) {
  return (
    <View layout={{ width: 22, height: 22, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: tint(color, 0.2) }}>
      {icon && <Icon icon={icon} size={14} strokeWidth={2} color={color} />}
    </View>
  );
}

function Row({ icon, color, title, note, bad }: { icon: IconSource | null; color: number; title: string; note: string; bad?: boolean }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 5, paddingBottom: 5 }}>
      <Square icon={icon} color={bad ? RED : color} />
      <View layout={{ flex: 1 }}>
        <Label text={title} size={TEXT.sm} weight="600" color={bad ? RED : ROLE.ink} truncate />
      </View>
      <Label text={note} size={TEXT.xs} font="mono" color={ROLE.muted} />
    </View>
  );
}

function Heading({ text }: { text: string }) {
  return <Label text={text} size={11} weight="700" upper letterSpacing={0.6} color={ROLE.muted} layout={{ marginTop: 16, marginBottom: 4 }} />;
}

export function UpgradeIconSheet() {
  const list = packages();
  const users = new Map<string, string[]>();
  for (const u of list) {
    const key = upgradeIconKey(u, upgrades);
    if (key) {
      users.set(key, [...(users.get(key) ?? []), u.name]);
    }
  }
  const taken = new Set<IconSource>();
  for (const a of abilities) {
    taken.add(abilityGlyph(a.kind));
  }
  const priority: IconSource[] = [ChevronDown, Equal, ChevronUp, ChevronsUp, Flame];
  for (const p of priority) {
    taken.add(p);
  }
  return (
    <View layout={{ flex: 1, backgroundColor: ROLE.surface }}>
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ padding: 16 }}>
          <Label text="Upgrade icons" size={TEXT.lg} font="display" weight="700" color={ROLE.ink} />
          <Label text={`${list.length} packages, one glyph each. Red: missing, shared, or an ability's or priority's.`} size={TEXT.xs} color={ROLE.muted} wrap />
          <Heading text="Packages" />
          {list.map(u => {
            const key = upgradeIconKey(u, upgrades);
            const icon = getUpgradeIcon(u, upgrades);
            const shared = key ? (users.get(key)?.length ?? 0) > 1 : false;
            const bad = !icon || shared || taken.has(icon);
            const note = `${key ?? "none"}${shared ? " shared" : ""}${icon && taken.has(icon) ? " reserved" : ""} ${(u.tags ?? []).join("/")}`;
            return <Row key={u.id} icon={icon} color={schoolColor(u)} title={u.name} note={note} bad={bad} />;
          })}
          <Heading text="Ability glyphs (reserved)" />
          {abilities.map(a => <Row key={a.id} icon={abilityGlyph(a.kind)} color={COLOR.primary} title={a.name} note={a.kind} />)}
          <Heading text="Priority glyphs (reserved)" />
          {priority.map((p, i) => <Row key={i} icon={p} color={ROLE.muted} title={["Junior", "Senior", "Principal", "Architect", "Wizard"][i]} note="tier" />)}
          <Heading text="Registered keys" />
          <Label text={Object.keys(UPGRADE_ICONS).sort().join("  ")} size={TEXT.xs} font="mono" color={ROLE.muted} wrap />
        </View>
      </ScrollView>
    </View>
  );
}
