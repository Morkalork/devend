/**
 * The upgrade icon rules (src/components/game/upgradeIcons.ts): one glyph per
 * package, registered, unique across the shelf.
 *
 * Three packages shipped with keys the registry did not know (ruler, gauge,
 * zap) and drew an empty square, and seven glyphs were shared by two or three
 * packages each; nothing noticed, because an icon is the one field whose
 * absence looks like a style choice.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ChevronDown, ChevronUp, ChevronsUp, Equal, Flame } from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import { UPGRADE_ICONS, getUpgradeIcon, upgradeIconKey } from "@/components/game/upgradeIcons";
import { abilityGlyph } from "@/ui/game/bottomModel";

const ROOT = path.resolve(__dirname, "../..");
const upgrades = (yaml.load(fs.readFileSync(path.join(ROOT, "public/upgrades.yml"), "utf8")) as { upgrades: UpgradeConfig[] }).upgrades;
const abilities = (yaml.load(fs.readFileSync(path.join(ROOT, "public/abilities.yml"), "utf8")) as { abilities: { kind: string }[] }).abilities;

const packages = [...new Map(upgrades.map(u => [u.name, u])).values()];

describe("upgrade icons", () => {
  it("gives every package a glyph the registry knows", () => {
    const missing = packages.filter(u => !getUpgradeIcon(u, upgrades)).map(u => `${u.name} (${upgradeIconKey(u, upgrades) ?? "no key"})`);
    expect(missing).toEqual([]);
  });

  it("gives no two packages the same glyph", () => {
    const byKey = new Map<string, string[]>();
    for (const u of packages) {
      const key = upgradeIconKey(u, upgrades)!;
      byKey.set(key, [...(byKey.get(key) ?? []), u.name]);
    }
    const shared = [...byKey].filter(([, names]) => names.length > 1);
    expect(shared).toEqual([]);
  });

  it("keeps every tier of a package on the package's glyph", () => {
    for (const u of upgrades) {
      const first = packages.find(p => p.name === u.name)!;
      expect(getUpgradeIcon(u, upgrades), u.id).toBe(getUpgradeIcon(first, upgrades));
    }
  });

  it("never reuses an ability's or a priority's glyph", () => {
    const reserved = new Set<unknown>([
      ...abilities.map(a => abilityGlyph(a.kind)),
      ChevronDown, Equal, ChevronUp, ChevronsUp, Flame,
    ]);
    const clashes = packages.filter(u => reserved.has(getUpgradeIcon(u, upgrades))).map(u => u.name);
    expect(clashes).toEqual([]);
  });

  it("registers keys under lucide's own kebab-case names", () => {
    for (const key of Object.keys(UPGRADE_ICONS)) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(fs.existsSync(path.join(ROOT, "node_modules/lucide-react/dist/esm/icons", `${key}.mjs`)), key).toBe(true);
    }
  });
});
