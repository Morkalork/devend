/**
 * Localized accessors for YAML-authored game content: upgrades, certificates,
 * achievements, capstones, Sprint Planning offers, abilities, fence types,
 * balls, bugs, map mutators, map objectives and bosses (public/*.yml).
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
import { getBallType } from '@/lib/ballTypes';

type WithId = { id: string };

function field(
  t: TFunction, kind: string, id: string, name: string, fallback?: string,
  /** Interpolation values, for content whose text has a {{placeholder}}. */
  vars?: Record<string, string>,
): string {
  if (!id) return fallback ?? '';
  return t(`content.${kind}.${id}.${name}`, { defaultValue: fallback ?? '', ...vars }) as string;
}

export const contentText = {
  // A store retainer card (abilityOffer.ts) is an upgrade dressed around an
  // ability, so its copy is the ability's.
  upgradeName: (t: TFunction, u: WithId & { name?: string; grantsAbility?: string }) =>
    u.grantsAbility
      ? field(t, 'abilities', u.grantsAbility, 'name', u.name)
      : field(t, 'upgrades', u.id, 'name', u.name),
  upgradeDesc: (t: TFunction, u: WithId & { description?: string; grantsAbility?: string }) =>
    u.grantsAbility
      ? field(t, 'abilities', u.grantsAbility, 'description', u.description)
      : field(t, 'upgrades', u.id, 'description', u.description),

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

  /**
   * Ball type (balls.yml), by id. Falls back to the authored English name, and
   * to the id itself for a type the catalogue does not know - a mission that
   * renders "seal a grey ball" is still playable, one that renders "seal a
   * ball" is not.
   */
  ballName: (t: TFunction, id?: string): string => {
    if (!id) return '';
    return t(`content.balls.${id}.name`, { defaultValue: getBallType(id)?.name ?? id }) as string;
  },

  ballDesc: (t: TFunction, b: WithId & { description?: string }) => field(t, 'balls', b.id, 'description', b.description),

  /** Ability (abilities.yml): the one-shot powers on the ability bar. */
  abilityName: (t: TFunction, a: WithId & { name?: string }) => field(t, 'abilities', a.id, 'name', a.name),
  abilityDesc: (t: TFunction, a: WithId & { description?: string }) => field(t, 'abilities', a.id, 'description', a.description),
  abilityHowTo: (t: TFunction, a: WithId & { howTo?: string }) => field(t, 'abilities', a.id, 'howTo', a.howTo),

  /** Fence type (fences.yml): the slots under the board. */
  fenceName: (t: TFunction, f: WithId & { name?: string }) => field(t, 'fences', f.id, 'name', f.name),
  fenceDesc: (t: TFunction, f: WithId & { description?: string }) => field(t, 'fences', f.id, 'description', f.description),
  fenceHowTo: (t: TFunction, f: WithId & { howTo?: string }) => field(t, 'fences', f.id, 'howTo', f.howTo),

  /** Bug (bugs.yml): what squashing one gives, and what it costs. */
  bugName: (t: TFunction, b: WithId & { name?: string }) => field(t, 'bugs', b.id, 'name', b.name),
  bugDesc: (t: TFunction, b: WithId & { description?: string }) => field(t, 'bugs', b.id, 'description', b.description),
  bugCost: (t: TFunction, b: WithId & { cost?: string }) => field(t, 'bugs', b.id, 'cost', b.cost),

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

  /** Sprint Planning offer (offers.yml): name, upside and downside. */
  offerName: (t: TFunction, o: WithId & { name?: string }) => field(t, 'offers', o.id, 'name', o.name),
  offerDesc: (t: TFunction, o: WithId & { description?: string }) => field(t, 'offers', o.id, 'description', o.description),
  offerPrice: (t: TFunction, o: WithId & { priceText?: string }) => field(t, 'offers', o.id, 'priceText', o.priceText),
};
