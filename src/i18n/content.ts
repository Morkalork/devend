/**
 * Localized accessors for YAML-authored game content — upgrades, certificates,
 * achievements and loadouts (public/*.yml).
 *
 * The YAML files stay the **English source of truth**. Each translated
 * language fills in `content.<kind>.<id>.<field>` keys in its locale file
 * (e.g. `content.upgrades.runtime_optimisation_junior.name`). When a key is
 * missing, i18next falls back to the English YAML value via `defaultValue`,
 * so untranslated or newly-added content never renders blank.
 *
 * `tier` is a small shared enum across upgrades, so it lives under
 * `content.tiers.<Tier>` instead of being duplicated per upgrade id.
 *
 * Components already call `useTranslation()` for their chrome, so passing that
 * same `t` here means content re-localizes automatically on language change.
 */
import type { TFunction } from 'i18next';

type WithId = { id: string };

function field(t: TFunction, kind: string, id: string, name: string, fallback?: string): string {
  if (!id) return fallback ?? '';
  return t(`content.${kind}.${id}.${name}`, { defaultValue: fallback ?? '' }) as string;
}

export const contentText = {
  upgradeName: (t: TFunction, u: WithId & { name?: string }) => field(t, 'upgrades', u.id, 'name', u.name),
  upgradeDesc: (t: TFunction, u: WithId & { description?: string }) =>
    field(t, 'upgrades', u.id, 'description', u.description),

  /** Job-title tier (Junior, Senior, …) shared across all upgrades. */
  tier: (t: TFunction, tier?: string): string =>
    tier ? (t(`content.tiers.${tier}`, { defaultValue: tier }) as string) : (tier ?? ''),

  certName: (t: TFunction, c: WithId & { name?: string }) => field(t, 'certificates', c.id, 'name', c.name),
  certDesc: (t: TFunction, c: WithId & { description?: string }) =>
    field(t, 'certificates', c.id, 'description', c.description),

  achName: (t: TFunction, a: WithId & { name?: string }) => field(t, 'achievements', a.id, 'name', a.name),
  achDesc: (t: TFunction, a: WithId & { description?: string }) =>
    field(t, 'achievements', a.id, 'description', a.description),
  achBonus: (t: TFunction, a: WithId & { bonus?: { description?: string } }) =>
    field(t, 'achievements', a.id, 'bonusDescription', a.bonus?.description),

  /** Set bonus (tagSets in upgrades.yml); id = the archetype tag. */
  tagSetName: (t: TFunction, s: WithId & { name?: string }) => field(t, 'tagSets', s.id, 'name', s.name),
  tagSetDesc: (t: TFunction, s: WithId & { description?: string }) =>
    field(t, 'tagSets', s.id, 'description', s.description),

  /** Capstone (capstones.yml): the once-per-run Promotion perk. */
  capstoneName: (t: TFunction, c: WithId & { name?: string }) => field(t, 'capstones', c.id, 'name', c.name),
  capstoneDesc: (t: TFunction, c: WithId & { description?: string }) =>
    field(t, 'capstones', c.id, 'description', c.description),
  capstoneClarify: (t: TFunction, c: WithId & { clarify?: string }) =>
    field(t, 'capstones', c.id, 'clarify', c.clarify),

  /** Door (doors.yml): risk/reward gate between maps. */
  doorName: (t: TFunction, d: WithId & { name?: string }) => field(t, 'doors', d.id, 'name', d.name),
  doorRisk: (t: TFunction, d: WithId & { risk?: string }) => field(t, 'doors', d.id, 'risk', d.risk),
  doorReward: (t: TFunction, d: WithId & { reward?: string }) =>
    field(t, 'doors', d.id, 'reward', d.reward),
  doorClarify: (t: TFunction, d: WithId & { clarify?: string }) =>
    field(t, 'doors', d.id, 'clarify', d.clarify),

  /** Boss (map.yml boss block, issue #56): keyed on the level id. */
  bossName: (t: TFunction, b: WithId & { name?: string }) => field(t, 'bosses', b.id, 'name', b.name),
  bossIntro: (t: TFunction, b: WithId & { intro?: string }) => field(t, 'bosses', b.id, 'intro', b.intro),

  /** Map objective (objectives.yml): the per-map optional goal. */
  objectiveName: (t: TFunction, o: WithId & { name?: string }) => field(t, 'mapObjectives', o.id, 'name', o.name),
  objectiveDesc: (t: TFunction, o: WithId & { description?: string }) =>
    field(t, 'mapObjectives', o.id, 'description', o.description),
  objectiveClarify: (t: TFunction, o: WithId & { clarify?: string }) =>
    field(t, 'mapObjectives', o.id, 'clarify', o.clarify),

  /** Map mutator (mapMutators.yml): the per-map environmental modifier. */
  mutatorName: (t: TFunction, m: WithId & { name?: string }) => field(t, 'mapMutators', m.id, 'name', m.name),
  mutatorDesc: (t: TFunction, m: WithId & { description?: string }) =>
    field(t, 'mapMutators', m.id, 'description', m.description),
  mutatorClarify: (t: TFunction, m: WithId & { clarify?: string }) =>
    field(t, 'mapMutators', m.id, 'clarify', m.clarify),

  loadoutName: (t: TFunction, l: WithId & { name?: string }) => field(t, 'loadouts', l.id, 'name', l.name),
  loadoutCurse: (t: TFunction, l: WithId & { curse?: string }) => field(t, 'loadouts', l.id, 'curse', l.curse),
  loadoutBlessing: (t: TFunction, l: WithId & { blessing?: string }) =>
    field(t, 'loadouts', l.id, 'blessing', l.blessing),
};
