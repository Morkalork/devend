/**
 * The Performance Review: one bar per lane, showing which a run committed to.
 *
 * This is the half of the axis economy that makes it a CHOICE rather than a
 * formula. A player who cannot see that they filled Craft and left Tempo empty
 * has no basis for playing the next map differently, or for buying an upgrade
 * that supports the lane they favour. The itemised hours below it say what was
 * earned; this says what KIND of run it was.
 *
 * Deliberately shows empty axes too. An axis at zero is the more useful half of
 * the readout: it is the hours that were on the table and left there, and the
 * ring is built so that you can never fill all five.
 *
 * THE RIGHT-HAND NUMBER IS "earned/ceiling", and it has been both ways. It read
 * "18/30h", was changed to the shortfall "-12h" on the argument that a player
 * chases a full axis when they can see what the last one cost, and is now back.
 * What changed is the premise, not the taste: that argument leaned on the hours
 * banked being visible "in the itemised rows below", and those rows are gone.
 * They were duplicates of these axes - Thread Locks restated Delivery,
 * Superior Locks restated Craft - so the screen showed the same hours twice and
 * invited the player to add them up to a number the scorer never paid. With
 * them deleted, a bare "-12h" is the ONLY number on the row, and an axis that
 * paid 18h would report nothing but its deficit.
 *
 * A full axis still gets its own copy ("30h ✓") rather than "30/30h": the tick
 * is the thing worth seeing at a glance, and it is what the eye finds when
 * scanning five rows for which lanes actually landed.
 *
 * There is deliberately NO grand "you missed Nh" total. The four tactical axes
 * fight each other by construction, so about two are reachable in one run and
 * the sum of all five ceilings is not a score anyone can get. A deficit against
 * an impossible number would make every run look like a failure, which is both
 * demoralising and false.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Lock, Medal, Timer, Scissors, Flame, Hammer } from 'lucide-react';
import type { BankedAxes } from '@/types/scoring';
import { AXIS_NAMES, type AxisName } from '@/lib/scoreAxes';

/** Icon and colour per axis. Colours match the itemised rows below the block. */
const AXIS_STYLE: Record<AxisName, { icon: typeof Lock; color: string; bar: string }> = {
  delivery: { icon: Lock, color: 'text-cyan-400', bar: 'bg-cyan-400' },
  craft: { icon: Medal, color: 'text-cyan-300', bar: 'bg-cyan-300' },
  tempo: { icon: Timer, color: 'text-teal-400', bar: 'bg-teal-400' },
  thrift: { icon: Scissors, color: 'text-success', bar: 'bg-success' },
  greed: { icon: Flame, color: 'text-primary', bar: 'bg-primary' },
  engagement: { icon: Hammer, color: 'text-amber-400', bar: 'bg-amber-400' },
};

interface Props {
  axes: BankedAxes;
  /** Press-and-hold binding from the overlay, so each bar can explain itself. */
  hold?: (key: string) => Record<string, unknown>;
}

export function PerformanceReviewAxes({ axes, hold }: Props) {
  const { t } = useTranslation();

  return (
    <div className="py-2 border-b border-border">
      <div className="text-muted-foreground text-xs uppercase tracking-wide mb-2">
        {t('levelComplete.axes.title')}
      </div>

      <div className="flex flex-col gap-1.5">
        {AXIS_NAMES.filter(name => (
          // A lane the map never offered is not drawn at all.
          //
          // Engagement is the first axis that can be genuinely absent: the
          // other five are offered by every map, so an empty bar there means
          // "you left these hours on the table", which is the readout this
          // component exists to give. On a map that puts no feature on the
          // board, an empty Engagement bar would say the same thing and be a lie
          // - there
          // were no hours, and no play would have banked them. Hiding it is the
          // same call as the note above about a deficit against an impossible
          // number: false and demoralising.
          name !== 'engagement' || axes.ceilings.engagement > 0
        )).map((name, i) => {
          const style = AXIS_STYLE[name];
          const Icon = style.icon;
          const earned = axes[name];
          const ceiling = axes.ceilings[name];
          // A ceiling of zero means the map never offered this axis; show it as
          // empty rather than dividing by nothing.
          const fill = ceiling > 0 ? Math.min(1, earned / ceiling) : 0;
          const spent = earned > 0;
          // Rounded the same way the axis itself is, so the earned and missing
          // hours always add up to the ceiling on screen. Deriving it from the
          // unrounded ratio instead would show 18 + 13 = 30.
          const short = Math.max(0, ceiling - earned);
          const full = ceiling > 0 && short === 0;

          return (
            <div key={name} {...(hold?.(`axis_${name}`) ?? {})} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1 text-xs w-[5.5rem] shrink-0 ${
                  spent ? style.color : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="truncate">{t(`levelComplete.axes.${name}`)}</span>
              </span>

              <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${style.bar}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${fill * 100}%` }}
                  transition={{ duration: 0.45, delay: 0.1 + i * 0.07, ease: 'easeOut' }}
                />
              </div>

              <span
                className={`text-xs font-bold tabular-nums w-[4.25rem] text-right shrink-0 ${
                  full ? style.color : short > 0 ? 'text-destructive/80' : 'text-muted-foreground'
                }`}
              >
                {ceiling <= 0
                  ? '-'
                  : full
                    ? t('levelComplete.axes.full', { hours: earned })
                    : t('levelComplete.axes.outOf', { earned, ceiling })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
