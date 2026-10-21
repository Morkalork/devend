/**
 * Sprint Planning offers (SPRINT_PLANNING_PLAN.md): the run-start draft.
 *
 * Before map 1 the run deals three cards, one per pool (a boon, a
 * Specialisation, a gamble), and the player takes one or skips. When the
 * previous run earned Tenure, its chain takes the boon slot: the reward for
 * depth becomes "your boon is a lot better than usual", and choosing it over a
 * Specialisation or a gamble is the first time Tenure has been a decision.
 *
 * The catalogue is config-driven from public/offers.yml, loaded the way
 * features.yml is: baked into the bundle (so it is always there, tests and
 * Admin included) and re-fetched at run start by `loadOffers()`, so a deployed
 * build picks up YAML tweaks without a rebuild.
 *
 * Everything here is pure; useGameSession owns which offer the run took.
 */
import yaml from "js-yaml";
import offersYamlRaw from "../../public/offers.yml?raw";
import type { UpgradeConfig, UpgradeTag } from "@/types/upgrade";
import type { OfferCatalogue, OfferPool, OfferPrize, OfferUnlock, RunOffer, ShopLean } from "@/types/offer";
import { eligibleTenureChains, TENURE_THRESHOLDS, type TenureOffer } from "@/lib/tenure";
import { fetchConfig } from "@/lib/configFetch";

const TAGS: readonly UpgradeTag[] = ["lock", "freeze", "bank", "tempo", "risk", "safety"];

// ── Catalogue ───────────────────────────────────────────────────────────────

function numberRecord(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parsePrize(raw: unknown): OfferPrize | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind === "architect") return { kind: "architect" };
  if (r.kind !== "chain") return undefined;
  const steps = Math.round(Number(r.steps));
  if (steps !== 1 && steps !== 2 && steps !== 3) return undefined;
  const shoppedThrough = Math.max(1, Math.round(Number(r.shoppedThrough) || 1));
  const choose = Number.isFinite(Number(r.choose)) && Number(r.choose) > 1 ? Math.round(Number(r.choose)) : undefined;
  return { kind: "chain", steps, shoppedThrough, ...(choose ? { choose } : {}), ...(r.distinctTags === true ? { distinctTags: true } : {}) };
}

function parseUnlock(raw: unknown): OfferUnlock | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind === "levelReached" && Number.isFinite(Number(r.level))) return { kind: "levelReached", level: Math.round(Number(r.level)) };
  if (r.kind === "archetypeMet" && TAGS.includes(r.tag as UpgradeTag)) return { kind: "archetypeMet", tag: r.tag as UpgradeTag };
  if (r.kind === "always") return { kind: "always" };
  return undefined;
}

function parseOffer(raw: unknown, pool: OfferPool): RunOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.description !== "string") return null;
  const offer: RunOffer = { id: r.id, pool, name: r.name, description: r.description };
  if (typeof r.priceText === "string") offer.priceText = r.priceText;
  const modifiers = numberRecord(r.modifiers);
  if (modifiers) offer.modifiers = modifiers;
  const price = numberRecord(r.price);
  if (price) offer.price = price;
  if (Number.isFinite(Number(r.forMaps)) && Number(r.forMaps) > 0) offer.forMaps = Math.round(Number(r.forMaps));
  if (Number.isFinite(Number(r.overtime)) && Number(r.overtime) > 0) offer.overtime = Number(r.overtime);
  const prize = parsePrize(r.prize);
  if (prize) offer.prize = prize;
  const unlock = parseUnlock(r.unlock);
  if (unlock) offer.unlock = unlock;
  if (pool === "specialisation") {
    if (!TAGS.includes(r.tag as UpgradeTag)) return null; // a Specialisation IS its tag
    offer.tag = r.tag as UpgradeTag;
    offer.affinity = Math.max(0, Number(r.affinity) || 0);
    offer.guaranteedSlot = r.guaranteedSlot === true;
    offer.countsTowardSet = Math.max(0, Math.round(Number(r.countsTowardSet) || 0));
  }
  if (pool === "gamble") {
    offer.weight = Math.max(0, Number(r.weight) || 1);
    if (r.jackpot === true) offer.jackpot = true;
  }
  return offer;
}

/** Parse an offers.yml document (an empty catalogue on any failure). */
export function parseOfferCatalogue(text: string): OfferCatalogue {
  const empty: OfferCatalogue = { boons: [], specialisations: [], gambles: [] };
  try {
    const data = yaml.load(text) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return empty;
    const list = (key: string, pool: OfferPool) =>
      (Array.isArray(data[key]) ? (data[key] as unknown[]) : [])
        .map(o => parseOffer(o, pool))
        .filter((o): o is RunOffer => o !== null);
    return { boons: list("boons", "boon"), specialisations: list("specialisations", "specialisation"), gambles: list("gambles", "gamble") };
  } catch {
    return empty;
  }
}

let liveCatalogue = parseOfferCatalogue(offersYamlRaw);

/** The catalogue in effect (baked, or the last successful fetch). */
export function getOfferCatalogue(): OfferCatalogue {
  return liveCatalogue;
}

/** Every offer, pool by pool. */
export function allOffers(catalogue: OfferCatalogue = liveCatalogue): RunOffer[] {
  return [...catalogue.boons, ...catalogue.specialisations, ...catalogue.gambles];
}

export function getOffer(id: string | null | undefined, catalogue: OfferCatalogue = liveCatalogue): RunOffer | undefined {
  if (!id) return undefined;
  if (id === TENURE_OFFER.id) return TENURE_OFFER;
  return allOffers(catalogue).find(o => o.id === id);
}

/** Re-fetch offers.yml; on any failure the baked catalogue stays. */
export async function loadOffers(): Promise<boolean> {
  try {
    const response = await fetchConfig("/offers.yml");
    if (!response.ok) throw new Error(`Failed to load offers.yml: ${response.status}`);
    const parsed = parseOfferCatalogue(await response.text());
    if (allOffers(parsed).length === 0) return false;
    liveCatalogue = parsed;
    return true;
  } catch {
    return false;
  }
}

/** Test seam: back to the baked catalogue. */
export function resetOfferCatalogue(): void {
  liveCatalogue = parseOfferCatalogue(offersYamlRaw);
}

/**
 * Tenure's card in the boon slot. Synthetic, not in offers.yml: what it grants
 * is the chain the previous run earned, resolved at deal time.
 */
export const TENURE_OFFER: RunOffer = { id: "tenure", pool: "boon", name: "Tenure", description: "" };

// ── Unlocks ─────────────────────────────────────────────────────────────────

export interface OfferUnlockContext {
  highestLevelReached: number;
  /** Tags whose set bonus the player has fired in some run. */
  metArchetypes: readonly string[];
}

export function isOfferUnlocked(offer: RunOffer, ctx: OfferUnlockContext): boolean {
  const u = offer.unlock;
  if (!u || u.kind === "always") return true;
  if (u.kind === "levelReached") return ctx.highestLevelReached >= u.level;
  return ctx.metArchetypes.includes(u.tag);
}

/** What a locked offer is waiting for, for the collection page. Null when unlocked. */
export function offerUnlockGap(offer: RunOffer, ctx: OfferUnlockContext): OfferUnlock | null {
  return isOfferUnlocked(offer, ctx) ? null : offer.unlock ?? null;
}

// ── What a taken offer does ─────────────────────────────────────────────────

/** The shop's lean for the taken offer, or null when it is not a Specialisation. */
export function shopLeanOf(offer: RunOffer | null | undefined): ShopLean | null {
  if (!offer || offer.pool !== "specialisation" || !offer.tag) return null;
  return {
    tag: offer.tag,
    affinity: offer.affinity ?? 0,
    guaranteedSlot: offer.guaranteedSlot ?? false,
    countsTowardSet: offer.countsTowardSet ?? 0,
  };
}

/** Whether a `forMaps` offer's modifiers still apply, given maps cleared this run. */
export function offerModifiersActive(offer: RunOffer, mapsCompleted: number): boolean {
  return offer.forMaps === undefined || mapsCompleted < offer.forMaps;
}

/**
 * The modifiers a taken offer contributes right now: its price always, its
 * modifiers while they last. Two lists, merged by the caller's own rules, so
 * a multiplier in both compounds the way every other source does.
 */
export function offerModifierLayers(offer: RunOffer | null | undefined, mapsCompleted: number): Record<string, number>[] {
  if (!offer) return [];
  const layers: Record<string, number>[] = [];
  if (offer.price) layers.push(offer.price);
  if (offer.modifiers && offerModifiersActive(offer, mapsCompleted)) layers.push(offer.modifiers);
  return layers;
}

/**
 * Lives the pick changes, applied once: the offer's own extraLives (boon or
 * price) plus any life the granted upgrades carry, which a purchase would
 * have added too.
 */
export function pickLivesDelta(offer: RunOffer, granted: readonly UpgradeConfig[]): number {
  let delta = (offer.modifiers?.extraLives ?? 0) + (offer.price?.extraLives ?? 0);
  for (const u of granted) {
    const l = u.modifiers?.extraLives;
    if (typeof l === "number") delta += l;
  }
  return delta;
}

// ── Prizes ──────────────────────────────────────────────────────────────────

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** An Architect with every prerequisite under it, lowest first. */
export function architectWithAncestors(head: UpgradeConfig, upgrades: readonly UpgradeConfig[]): UpgradeConfig[] {
  const byId = new Map(upgrades.map(u => [u.id, u] as const));
  const out: UpgradeConfig[] = [];
  const seen = new Set<string>();
  const visit = (u: UpgradeConfig) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    for (const p of u.prerequisites ?? []) {
      const parent = byId.get(p);
      if (parent) visit(parent);
    }
    out.push(u);
  };
  visit(head);
  return out;
}

export type ResolvedPrize =
  | { grants: UpgradeConfig[]; choices?: undefined }
  | { grants: []; choices: TenureOffer[] };

/**
 * Turn a prize into concrete upgrades, so the card shows exactly what lands
 * (or, for a `choose` prize, the chains the player will pick from). Null when
 * the catalogue cannot pay it, which takes the offer out of this deal.
 */
export function resolvePrize(prize: OfferPrize, upgrades: UpgradeConfig[], rng: () => number): ResolvedPrize | null {
  if (prize.kind === "architect") {
    const heads = upgrades.filter(u => u.tier === "Architect");
    if (heads.length === 0) return null;
    return { grants: architectWithAncestors(heads[Math.floor(rng() * heads.length)], upgrades) };
  }
  // Tenure resolves chains by the depth that pays for them; the thresholds
  // ARE the step counts (10 -> one tier, 20 -> two, 30 -> three).
  const chains = shuffled(eligibleTenureChains(upgrades, TENURE_THRESHOLDS[prize.steps - 1], rng, prize.shoppedThrough), rng);
  if (chains.length === 0) return null;
  if (!prize.choose) return { grants: chains[0].upgrades };
  let picks = chains;
  if (prize.distinctTags) {
    const seenTags = new Set<string>();
    picks = chains.filter(c => {
      const tag = c.upgrades[0].tags?.[0];
      if (!tag || seenTags.has(tag)) return false;
      seenTags.add(tag);
      return true;
    });
  }
  return { grants: [], choices: picks.slice(0, prize.choose) };
}

// ── The deal ────────────────────────────────────────────────────────────────

/** A card on the Sprint Planning screen, already resolved. */
export interface DealtOffer {
  offer: RunOffer;
  /** Upgrades that land on the pick (empty for a choose prize). */
  grants: UpgradeConfig[];
  /** For a choose prize: the chains the player picks one of after the draft. */
  choices?: TenureOffer[];
  /** Set on the Tenure card. */
  tenure?: { earnedAtLevel: number; continued: boolean };
}

export interface SprintDealInput {
  catalogue: OfferCatalogue;
  upgrades: UpgradeConfig[];
  unlock: OfferUnlockContext;
  rng: () => number;
  /** The chain the previous run earned; takes the boon slot. */
  tenure?: { chain: TenureOffer; earnedAtLevel: number; continued: boolean } | null;
  /** Admin: put this offer in its pool's slot, and/or the jackpot in the gamble slot. */
  force?: { offerId?: string | null; jackpot?: boolean };
}

/** Candidates in the order they are tried: weighted for gambles, shuffled otherwise. */
function drawOrder(pool: RunOffer[], rng: () => number, weighted: boolean): RunOffer[] {
  if (!weighted) return shuffled(pool, rng);
  const left = [...pool];
  const out: RunOffer[] = [];
  while (left.length > 0) {
    const total = left.reduce((s, o) => s + (o.weight ?? 1), 0);
    let r = rng() * total;
    let idx = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= left[i].weight ?? 1;
      if (r <= 0) { idx = i; break; }
    }
    out.push(left.splice(idx, 1)[0]);
  }
  return out;
}

function dealOne(candidates: RunOffer[], upgrades: UpgradeConfig[], rng: () => number): DealtOffer | null {
  for (const offer of candidates) {
    if (!offer.prize) return { offer, grants: [] };
    const resolved = resolvePrize(offer.prize, upgrades, rng);
    if (resolved) return { offer, grants: resolved.grants, ...(resolved.choices ? { choices: resolved.choices } : {}) };
  }
  return null;
}

/**
 * The three cards, boon first. A pool with nothing unlocked (or nothing the
 * catalogue can pay) simply deals no card, so the screen never shows a dud.
 */
export function rollSprintDeal(input: SprintDealInput): DealtOffer[] {
  const { catalogue, upgrades, unlock, rng, tenure, force } = input;
  const forced = force?.offerId ? allOffers(catalogue).find(o => o.id === force.offerId) : undefined;
  const jackpots = force?.jackpot ? catalogue.gambles.filter(g => g.jackpot) : [];
  const pools: [OfferPool, RunOffer[]][] = [
    ["boon", catalogue.boons],
    ["specialisation", catalogue.specialisations],
    ["gamble", catalogue.gambles],
  ];
  const cards: DealtOffer[] = [];
  for (const [pool, offers] of pools) {
    if (pool === "boon" && tenure && forced?.pool !== "boon") {
      cards.push({ offer: TENURE_OFFER, grants: tenure.chain.upgrades, tenure: { earnedAtLevel: tenure.earnedAtLevel, continued: tenure.continued } });
      continue;
    }
    // A forced offer skips its unlock: Admin is how a locked card gets looked at.
    let candidates: RunOffer[];
    if (forced?.pool === pool) candidates = [forced];
    else if (pool === "gamble" && jackpots.length > 0) candidates = jackpots;
    else candidates = drawOrder(offers.filter(o => isOfferUnlocked(o, unlock)), rng, pool === "gamble");
    const card = dealOne(candidates, upgrades, rng);
    if (card) cards.push(card);
  }
  return cards;
}
