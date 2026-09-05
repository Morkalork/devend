/**
 * Authoring a map's win.
 *
 * Until now a map's win was an accident of which LevelConfig fields happened to
 * be set, read by a fixed chain of `if`s where a gate area or a boss REPLACED
 * the space clear rather than adding to it. There was no field an editor could
 * bind to, so "what does this map ask of you" was not a question the builder
 * could answer, let alone change.
 *
 * Two things here earn their keep beyond the list itself:
 *
 * The PREVIEW renders the exact sentences the in-game Acceptance Criteria modal
 * will show, from the same builder, because the check a win condition really
 * needs is not "is it valid" but "can a player understand what it wants".
 *
 * The PROBLEMS list flags a spec that can never be met. A `require` list makes
 * an unwinnable map easy to author by accident and the failure is silent: the
 * map simply never completes and the author assumes they misplayed it. Same job
 * as the mover path turning red when its patrol leaves the board.
 */
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Trophy, AlertTriangle, Eye, RotateCcw } from 'lucide-react';
import type { LevelConfig } from '@/types/level';
import type { WinCondition, WinConditionKind } from '@/types/winSpec';
import { WIN_CONDITION_KINDS } from '@/types/winSpec';
import { resolveWinSpec, winSpecProblems, areasGatingWin } from '@/lib/winSpec';
import { winConditionsBody } from '@/lib/winConditions';
import { getAllBallTypes } from '@/lib/ballTypes';

/** Short editor labels. Distinct from the player-facing sentences on purpose:
 *  the author needs the mechanic named, the player needs it explained. */
const KIND_LABEL: Record<WinConditionKind, string> = {
  space: 'Clear the board',
  locks: 'Lock N balls',
  superiorLocks: 'Land N superior locks',
  area: 'N balls in the coloured area',
  lockType: 'Lock a specific ball',
  boss: 'Defeat the boss',
  allLocked: 'Lock every ball',
  delivered: 'Deliver N balls into a box',
  smashed: 'Smash N breakables',
  terminals: 'Light N circuit terminals',
  harvested: 'Harvest N stream seams',
  underPar: 'Finish under par',
  speedClear: 'Finish within N seconds',
};

/** A fresh clause of each kind, seeded with a value that means something. */
function blankCondition(kind: WinConditionKind, level: LevelConfig): WinCondition {
  switch (kind) {
    case 'space': return { kind, threshold: level.sizeThreshold };
    case 'locks': return { kind, count: 1 };
    case 'superiorLocks': return { kind, count: 1 };
    case 'area': return { kind, count: 1 };
    case 'lockType': return { kind, ballType: 'black', count: 1 };
    case 'boss': return { kind };
    case 'allLocked': return { kind };
    // `delivered` was a clause the runtime understood and the panel could not
    // author: it was missing from WIN_CONDITION_KINDS, so it never reached this
    // switch. Listing it without a case here would have returned undefined.
    case 'delivered': return { kind, count: 1 };
    case 'smashed': return { kind, count: 1 };
    case 'terminals': return { kind, count: 1 };
    case 'harvested': return { kind, count: 1 };
    case 'underPar': return { kind, delta: 0 };
    case 'speedClear': return { kind, seconds: 60 };
  }
}

interface Props {
  level: LevelConfig;
  onUpdateLevel: (level: LevelConfig) => void;
}

export function WinConditionsPanel({ level, onUpdateLevel }: Props) {
  const { t } = useTranslation();
  const spec = resolveWinSpec(level);
  const problems = winSpecProblems(spec, level);
  const preview = winConditionsBody(t, level, level.level ?? 1);
  const sumPercent = (cs: WinCondition[]) =>
    cs.reduce((a, c) => a + (c.bonusPercent && c.bonusPercent > 0 ? c.bonusPercent : 0), 0);
  const requiredPremium = sumPercent(spec.require);
  // Only the alternative that fires pays, so the honest figure is the best one
  // on offer rather than their sum.
  const altPremium = Math.max(0, ...spec.alsoWinIf.map(c => c.bonusPercent ?? 0));

  /**
   * Write an edited spec onto the level, which makes it authored from here on.
   *
   * Asking for an area lock also makes the map's areas GATE the win, when none
   * of them did. The two used to be separate acts in separate panels - the
   * clause here, the "Win gate" checkbox over in the area editor - so it was
   * possible, and easy, to do only the first half and end up with a clause that
   * can never be satisfied. Level 5 shipped that way. See areasGatingWin for
   * why it only fires when nothing gates the win yet.
   */
  const write = (require: WinCondition[], alsoWinIf: WinCondition[]) => {
    const areas = level.coloredAreas;
    const next: LevelConfig = { ...level, win: { require, alsoWinIf } };
    if (areas?.length) next.coloredAreas = areasGatingWin(areas, require, alsoWinIf);
    onUpdateLevel(next);
  };

  const editGroup = (group: 'require' | 'alsoWinIf') => ({
    add: (kind: WinConditionKind) => {
      const next = [...spec[group], blankCondition(kind, level)];
      write(group === 'require' ? next : spec.require, group === 'require' ? spec.alsoWinIf : next);
    },
    remove: (i: number) => {
      const next = spec[group].filter((_, n) => n !== i);
      write(group === 'require' ? next : spec.require, group === 'require' ? spec.alsoWinIf : next);
    },
    update: (i: number, c: WinCondition) => {
      const next = spec[group].map((old, n) => (n === i ? c : old));
      write(group === 'require' ? next : spec.require, group === 'require' ? spec.alsoWinIf : next);
    },
  });

  /**
   * Drop the authored spec and go back to the derived one.
   *
   * Worth a button because authoring is one-way otherwise: the moment you touch
   * a clause the level carries a `win:` block that overrides the derivation, and
   * without this there is no way back to "whatever this map used to do" short of
   * editing the YAML by hand.
   */
  const revert = () => {
    const next = { ...level };
    delete next.win;
    onUpdateLevel(next);
  };

  return (
    <div className="border-b border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" />
          Win conditions
        </h3>
        {spec.authored ? (
          <button
            onClick={revert}
            className="flex items-center gap-1 px-2 py-1 rounded bg-muted hover:bg-muted/80 text-[11px] text-muted-foreground transition-colors"
            title="Delete the authored win block and go back to the derived one"
          >
            <RotateCcw className="w-3 h-3" /> Revert to default
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground/70" title="Derived from sizeThreshold, locks, gate areas and boss">
            derived
          </span>
        )}
      </div>

      <Group
        title="Required"
        hint="All of these must be met."
        conditions={spec.require}
        level={level}
        {...editGroup('require')}
      />
      <Group
        title="Also wins if"
        hint="Any one of these ends the map outright."
        conditions={spec.alsoWinIf}
        level={level}
        {...editGroup('alsoWinIf')}
      />

      {/* The map's total premium, so a list of clauses can be read as one
          number. Required clauses all pay (you cannot win without them); an
          alternative pays only when it is the route that fired, which is why
          the two are totalled separately. */}
      {(requiredPremium > 0 || altPremium > 0) && (
        <div className="flex items-center justify-between rounded bg-violet-500/10 border border-violet-500/30 px-2 py-1.5 text-[11px]">
          <span className="text-violet-300">Win premium</span>
          <span className="font-mono text-violet-300">
            +{requiredPremium}%{altPremium > 0 && ` (or +${altPremium}% by the alternative)`}
          </span>
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded border border-destructive/50 bg-destructive/15 p-2 space-y-1">
          {problems.map((p, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* The player's own words, not a paraphrase: this is the modal's builder. */}
      <div className="rounded bg-muted/50 p-2 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Eye className="w-3 h-3" /> What the player is told
        </div>
        <p className="text-[11px] text-foreground leading-relaxed">{preview}</p>
      </div>
    </div>
  );
}

function Group({ title, hint, conditions, level, add, remove, update }: {
  title: string;
  hint: string;
  conditions: WinCondition[];
  level: LevelConfig;
  add: (kind: WinConditionKind) => void;
  remove: (i: number) => void;
  update: (i: number, c: WinCondition) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>

      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded bg-muted/40 p-1.5">
          <select
            value={c.kind}
            onChange={(e) => update(i, blankCondition(e.target.value as WinConditionKind, level))}
            className="flex-1 min-w-0 px-1.5 py-1 rounded bg-background border border-border text-[11px]"
          >
            {WIN_CONDITION_KINDS.map(k => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <ConditionParams condition={c} onChange={(next) => update(i, next)} />
          {/* What this clause is worth. Sits in the row rather than on the
              level, so a hard condition and its price are written together and
              you cannot add one without pricing it. */}
          <div className="flex items-center shrink-0" title="Extra pay, as a percent of what the map earned">
            <span className="text-[10px] text-violet-400 pr-0.5">+</span>
            <input
              type="number"
              value={c.bonusPercent ?? 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                const next = { ...c } as WinCondition;
                if (n > 0) next.bonusPercent = n; else delete next.bonusPercent;
                update(i, next);
              }}
              className="w-12 px-1 py-1 rounded bg-background border border-violet-500/40 text-[11px] text-violet-300"
            />
            <span className="text-[10px] text-violet-400 pl-0.5">%</span>
          </div>
          <button
            onClick={() => remove(i)}
            className="p-1 rounded text-destructive hover:bg-destructive/20 transition-colors shrink-0"
            title="Remove"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      <select
        value=""
        onChange={(e) => e.target.value && add(e.target.value as WinConditionKind)}
        className="w-full px-1.5 py-1 rounded bg-muted hover:bg-muted/80 border border-border text-[11px] text-muted-foreground transition-colors"
      >
        <option value="">+ add condition</option>
        {WIN_CONDITION_KINDS.map(k => (
          <option key={k} value={k}>{KIND_LABEL[k]}</option>
        ))}
      </select>
    </div>
  );
}

/** The one or two numbers a clause needs, or nothing for the flag kinds. */
function ConditionParams({ condition, onChange }: {
  condition: WinCondition;
  onChange: (c: WinCondition) => void;
}) {
  const num = (value: number, set: (n: number) => void, title: string, width = 'w-14') => (
    <input
      type="number"
      value={value}
      title={title}
      onChange={(e) => set(Number(e.target.value))}
      className={`${width} px-1.5 py-1 rounded bg-background border border-border text-[11px] shrink-0`}
    />
  );

  switch (condition.kind) {
    case 'space':
      return num(condition.threshold, n => onChange({ ...condition, threshold: n }), '% of the board left');
    case 'locks':
    case 'superiorLocks':
    case 'area':
      return num(condition.count, n => onChange({ ...condition, count: n }), 'How many');
    case 'lockType':
      return (
        <>
          <select
            value={condition.ballType}
            onChange={(e) => onChange({ ...condition, ballType: e.target.value })}
            className="w-24 px-1.5 py-1 rounded bg-background border border-border text-[11px] shrink-0"
          >
            {getAllBallTypes().map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {num(condition.count, n => onChange({ ...condition, count: n }), 'How many')}
        </>
      );
    case 'underPar':
      return num(condition.delta, n => onChange({ ...condition, delta: n }), 'Cuts allowed relative to par');
    case 'speedClear':
      return num(condition.seconds, n => onChange({ ...condition, seconds: n }), 'Active seconds', 'w-16');
    case 'boss':
    case 'allLocked':
      return null;
  }
}
