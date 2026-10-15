/**
 * Every YAML string the player reads has a translation in every language.
 *
 * The YAML in public/ is the English source of truth, and contentText
 * (src/i18n/content.ts) falls back to it when a `content.<kind>.<id>.<field>`
 * key is missing. That fallback is right for a deployed build (a new upgrade
 * never renders blank) and wrong as a resting state: it is how the abilities,
 * fence types, balls and bugs stayed English in Spanish, Swedish and Bangla
 * without anything failing. So the fallback is allowed at runtime and not here.
 *
 * The table below is the list of displayed fields per catalogue, matching the
 * contentText accessors. A new catalogue, or a new displayed field, gets a row.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { supportedLanguages } from "@/i18n";

const ROOT = path.resolve(__dirname, "../..");

type Item = Record<string, unknown>;

function load(file: string): Record<string, unknown> {
  return yaml.load(fs.readFileSync(path.join(ROOT, `public/${file}`), "utf8")) as Record<string, unknown>;
}

interface Source {
  kind: string;
  items: Item[];
  /** Displayed fields; a dotted path reads a nested one, keyed by its last part. */
  fields: { path: string; key: string }[];
  idKey?: string;
}

const f = (...paths: string[]) => paths.map(p => ({ path: p, key: p.split(".").pop()! }));

function sources(): Source[] {
  const upgrades = load("upgrades.yml") as { upgrades: Item[]; tagSets: { bonuses: Item[] } };
  const offers = load("offers.yml") as Record<string, Item[]>;
  const levels = (load("map.yml") as { levels: Item[] }).levels;
  const bossLevels = levels.filter(l => l.boss);
  return [
    { kind: "abilities", items: load("abilities.yml").abilities as Item[], fields: f("name", "description", "howTo") },
    { kind: "balls", items: load("balls.yml").balls as Item[], fields: f("name", "description") },
    { kind: "bugs", items: load("bugs.yml").bugs as Item[], fields: f("name", "description", "cost") },
    { kind: "fences", items: load("fences.yml").fences as Item[], fields: f("name", "description", "howTo") },
    { kind: "capstones", items: load("capstones.yml").capstones as Item[], fields: f("name", "description", "clarify") },
    { kind: "certificates", items: load("certificates.yml").certificates as Item[], fields: f("name", "description") },
    {
      kind: "achievements", items: load("achievements.yml").achievements as Item[],
      fields: [...f("name", "description"), { path: "bonus.description", key: "bonusDescription" }],
    },
    { kind: "mapMutators", items: load("mapMutators.yml").mutators as Item[], fields: f("name", "description", "clarify") },
    {
      kind: "mapObjectives",
      items: [
        ...(load("objectives.yml").objectives as Item[]),
        ...bossLevels.flatMap(l => {
          const objective = (l.boss as Item).objective as Item | undefined;
          return objective ? [objective] : [];
        }),
      ],
      fields: f("name", "description", "clarify"),
    },
    { kind: "upgrades", items: upgrades.upgrades, fields: f("name", "description") },
    { kind: "tagSets", items: upgrades.tagSets.bonuses, fields: f("name", "description"), idKey: "tag" },
    {
      kind: "offers", items: [...offers.boons, ...offers.specialisations, ...offers.gambles],
      fields: f("name", "description", "priceText"),
    },
    // Bosses are keyed on their level's id (GameScreen passes level.id).
    { kind: "bosses", items: bossLevels.map(l => ({ ...(l.boss as Item), id: l.id })), fields: f("name", "intro") },
  ];
}

function read(item: Item, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Item)[k] : undefined), item);
}

describe("YAML content translations", () => {
  const all = sources();

  it("reads a non-empty catalogue for every kind", () => {
    for (const s of all) {
      expect(s.items.length, s.kind).toBeGreaterThan(0);
    }
  });

  for (const lang of supportedLanguages.filter(l => l !== "en")) {
    it(`has a ${lang} string for every displayed field`, () => {
      const locale = JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${lang}.json`), "utf8"));
      const missing: string[] = [];
      const dashed: string[] = [];
      for (const s of all) {
        for (const item of s.items) {
          const id = String(item[s.idKey ?? "id"]);
          for (const fld of s.fields) {
            const english = read(item, fld.path);
            if (typeof english !== "string" || english.trim() === "") {
              continue;
            }
            const key = `content.${s.kind}.${id}.${fld.key}`;
            const value = locale.content?.[s.kind]?.[id]?.[fld.key];
            if (typeof value !== "string" || value.trim() === "") {
              missing.push(key);
            } else if (value.includes("—")) {
              dashed.push(key);
            }
          }
        }
      }
      expect(missing).toEqual([]);
      expect(dashed, "em-dash in UI text").toEqual([]);
    });
  }
});
