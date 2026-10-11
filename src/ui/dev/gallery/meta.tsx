/**
 * Gallery entries: the menu ("meta") screens. Catalogue screens read the real
 * YAML (baked in with `?raw`, like lib/bugs.ts), so what is looked at here is
 * the copy the player sees; the player's own progress is hand-written.
 */
import { useEffect, useState } from "react";
import yaml from "js-yaml";
import type { GalleryEntry } from "../galleryTypes";
import musicYamlRaw from "../../../../public/music.yml?raw";
import certificatesYamlRaw from "../../../../public/certificates.yml?raw";
import loadoutsYamlRaw from "../../../../public/loadouts.yml?raw";
import achievementsYamlRaw from "../../../../public/achievements.yml?raw";
import { parseMusicDoc } from "@/lib/musicCatalogue";
import type { Achievement } from "@/types/achievement";
import type { CertConfig } from "@/types/certificate";
import type { LoadoutConfig } from "@/types/loadout";
import type { RunLedgerEntry } from "@/types/hallOfFame";
import { DEFAULT_META_STATS, type MetaProgressionStats } from "@/types/metaProgression";
import { WelcomeScreen } from "../../screens/WelcomeScreen";
import { TapToStartGate } from "../../screens/TapToStartGate";
import { OptionsScreen } from "../../screens/OptionsScreen";
import { TutorialScreen } from "../../screens/TutorialScreen";
import { JukeboxScreen } from "../../screens/JukeboxScreen";
import { PairDecision } from "../../screens/PairDecision";
import { AchievementsScreen } from "../../screens/AchievementsScreen";
import { HallOfFameScreen } from "../../screens/HallOfFameScreen";
import { CertificateStore } from "../../screens/CertificateStore";
import { LoadoutGalleryScreen } from "../../screens/LoadoutGalleryScreen";
import { PairLobby } from "../../screens/PairLobby";

const ACCENT = "#00ff88";
const noop = () => {};

// ── Catalogues ─────────────────────────────────────────────────────────────

const music = parseMusicDoc(yaml.load(musicYamlRaw) as Record<string, unknown>);
const certificates = (yaml.load(certificatesYamlRaw) as CertConfig).certificates;
const loadouts = (yaml.load(loadoutsYamlRaw) as { loadouts: LoadoutConfig[] }).loadouts;
const achievements = (yaml.load(achievementsYamlRaw) as { achievements: Achievement[] }).achievements;

// ── A mid-game player ──────────────────────────────────────────────────────

const metaStats: MetaProgressionStats = {
  ...DEFAULT_META_STATS,
  highestLevelReached: 14,
  totalFencesDrawn: 412,
  totalLevelsCompletedWithoutLoss: 9,
  totalLivesLost: 23,
  deepestAscension: 2,
  pushBonusesBanked: 6,
};

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 12);
const run = (score: number, over: Partial<RunLedgerEntry> = {}): RunLedgerEntry => ({
  score, levelsCompleted: 12, ascensionDepth: 0, primaryTag: null, secondaryTag: null,
  capstoneId: null, capstoneName: null, loadoutIds: [], savedAt: NOW, ...over,
});
const topRuns: RunLedgerEntry[] = [
  run(612, { levelsCompleted: 22, ascensionDepth: 2, primaryTag: "lock", secondaryTag: "risk", capstoneId: "stock-options", capstoneName: "Stock Options", savedAt: NOW - DAY }),
  run(488, { levelsCompleted: 20, ascensionDepth: 1, primaryTag: "freeze", savedAt: NOW - 3 * DAY }),
  run(301, { levelsCompleted: 16, primaryTag: "bank", secondaryTag: "tempo", savedAt: NOW - 9 * DAY }),
  run(140, { levelsCompleted: 11, savedAt: NOW - 20 * DAY }),
  run(52, { levelsCompleted: 5, primaryTag: "safety", savedAt: NOW - 40 * DAY }),
];

const completedIds = achievements.slice(0, 4).map(a => a.id);
const activatedIds = completedIds.slice(0, 2);

// ── Entries ────────────────────────────────────────────────────────────────

const welcome = {
  onStartGame: noop, onTutorial: noop, onOptions: noop, accentColor: ACCENT,
};

/** The menu as a first launch meets a failed load: the error arrives after the
 *  menu is up, so the page grows under a scroll view that is already laid out. */
function WelcomeLateError() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setError("Failed to fetch"), 1500);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <WelcomeScreen {...welcome} onContinue={noop} onDaily={noop} onTwoPlayer={noop} onLoadouts={noop}
      onHallOfFame={noop} onJukebox={noop} error={error} />
  );
}

export const entries: GalleryEntry[] = [
  {
    id: "WelcomeScreen", group: "screen", render: () => (
      <WelcomeScreen {...welcome} onContinue={noop} savedRunAscension={2} onOpenCertificateStore={noop}
        onLoadouts={noop} onHallOfFame={noop} onDaily={noop} onTwoPlayer={noop} onAchievements={noop}
        onJukebox={noop} onAdmin={noop} totalCertificateHours={18} completedAchievementCount={4} />
    ),
  },
  {
    id: "WelcomeScreen-first", group: "screen", render: () => (
      // A first launch: no save, certificates still locked, Start Game highlighted.
      <WelcomeScreen {...welcome} onTwoPlayer={noop} highlights={{ newGame: true }} />
    ),
  },
  {
    id: "WelcomeScreen-error", group: "screen", render: () => (
      <WelcomeScreen {...welcome} onContinue={noop} onOpenCertificateStore={noop} onLoadouts={noop}
        onHallOfFame={noop} onDaily={noop} onTwoPlayer={noop} onAchievements={noop} onJukebox={noop}
        error="Failed to fetch" />
    ),
  },
  { id: "WelcomeScreen-lateError", group: "screen", render: () => <WelcomeLateError /> },
  {
    id: "WelcomeScreen-daily", group: "screen", render: () => (
      <WelcomeScreen {...welcome} onContinue={noop} onOpenCertificateStore={noop} onHallOfFame={noop}
        onDaily={noop} onTwoPlayer={noop} pairPartnerName="Robin" onAchievements={noop} dailyStreak={6} dailyDoneToday
        totalCertificateHours={7} completedAchievementCount={3}
        highlights={{ daily: true, records: true, certificates: true, achievements: true }} />
    ),
  },
  {
    id: "WelcomeScreen-loading", group: "screen", render: () => (
      <WelcomeScreen {...welcome} onContinue={noop} onDaily={noop} onTwoPlayer={noop} onAchievements={noop} isLoading />
    ),
  },
  // Shows only while the browser is waiting for a gesture to unlock audio
  // (isAwaitingUserGesture), which props cannot force: once sound is unlocked
  // this entry draws nothing.
  { id: "TapToStartGate", group: "screen", render: () => <TapToStartGate accentColor={ACCENT} /> },
  {
    id: "OptionsScreen", group: "screen", render: () => (
      <OptionsScreen onBack={noop} onReEnableTutorials={noop} onTotalReset={noop} accentColor={ACCENT} />
    ),
  },
  {
    id: "TutorialScreen", group: "screen", render: () => (
      <TutorialScreen onBack={noop} accentColor={ACCENT} encounteredBallTypeIds={["blue", "yellow"]} />
    ),
  },
  {
    id: "JukeboxScreen", group: "screen", render: () => (
      <JukeboxScreen catalogue={music} onBack={noop} accentColor={ACCENT} />
    ),
  },
  {
    id: "PairDecision-host", group: "screen", render: () => (
      <PairDecision isHost remoteName="Robin" mine={{ runId: "r1", levelIndex: 6, savedAt: NOW }}
        theirs={{ runId: "r1", levelIndex: 5, savedAt: NOW - DAY }} onContinue={noop} onNew={noop} onLeave={noop} />
    ),
  },
  {
    id: "PairDecision-guest", group: "screen", render: () => (
      <PairDecision isHost={false} remoteName="Robin" mine={{ runId: "r1", levelIndex: 6, savedAt: NOW }}
        theirs={null} onContinue={noop} onNew={noop} onLeave={noop} />
    ),
  },
  {
    id: "PairDecision-fresh", group: "screen", render: () => (
      <PairDecision isHost remoteName="Robin" mine={null} theirs={null} onContinue={noop} onNew={noop} onLeave={noop} />
    ),
  },
  {
    id: "AchievementsScreen", group: "screen", render: () => (
      <AchievementsScreen achievements={achievements} completedIds={completedIds} activatedIds={activatedIds}
        metaStats={metaStats} onActivate={noop} onBack={noop} accentColor={ACCENT} />
    ),
  },
  {
    id: "HallOfFameScreen", group: "screen", render: () => (
      <HallOfFameScreen
        topRuns={topRuns}
        monthlyBests={{ "2026-10": topRuns[0], "2026-09": topRuns[2], "2026-08": topRuns[3] }}
        dailyBests={{ "2026-10-10": run(88), "2026-10-09": run(120), "2026-10-08": run(64), "2026-10-06": run(97) }}
        dailyStreak={{ count: 3, lastKey: "2026-10-10" }}
        archetypeBests={{ lock: 612, freeze: 488, bank: 301 }}
        mapHighscores={{ "level-1": 14, "level-2": 22, "level-10": 61, "level-3": 30, "level-14": 75 }}
        metaStats={metaStats} onBack={noop} accentColor={ACCENT} />
    ),
  },
  {
    id: "HallOfFameScreen-empty", group: "screen", render: () => (
      <HallOfFameScreen topRuns={[]} archetypeBests={{}} mapHighscores={{}} metaStats={DEFAULT_META_STATS} onBack={noop} accentColor={ACCENT} />
    ),
  },
  {
    id: "CertificateStore", group: "screen", render: () => (
      <CertificateStore
        certificates={certificates}
        totalCertificateHours={18}
        certLevelsOwned={{ "signing-bonus": 1, "corporate-card": 2 }}
        unlockedCertIds={["signing-bonus", "corporate-card", "runtime-augmentation"]}
        maxTierCounts={{}}
        onPurchaseCertLevel={noop} onBack={noop} accentColor={ACCENT}
        achievements={achievements} metaStats={metaStats} lifetimeHoursSpent={12} />
    ),
  },
  {
    id: "CertificateStore-tutorial", group: "screen", render: () => (
      <CertificateStore certificates={certificates} totalCertificateHours={4} certLevelsOwned={{}} unlockedCertIds={[]}
        maxTierCounts={{}} onPurchaseCertLevel={noop} onBack={noop} accentColor={ACCENT} showTutorial onTutorialDismiss={noop} />
    ),
  },
  {
    id: "LoadoutGalleryScreen", group: "screen", render: () => (
      <LoadoutGalleryScreen loadouts={loadouts} wonLoadoutIds={["crunch_time", "scope_creep", "hiring_freeze"]} onBack={noop} accentColor={ACCENT} />
    ),
  },
  { id: "PairLobby", group: "screen", render: () => <PairLobby onBack={noop} onPaired={noop} /> },
];
