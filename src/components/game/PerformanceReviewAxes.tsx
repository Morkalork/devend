/**
 * The Performance Review: five bars showing which lanes a run committed to.
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
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Lock, Medal, Timer, Scissors, Flame } from 'lucide-react';
import type { BankedAxes } from '@/types/scoring';
import { AXIS_NAMES, type AxisName } from '@/lib/scoreAxes';

/** Icon and colour per axis. Colours match the itemised rows below the block. */
const AXIS_STYLE: Record<AxisName, { icon: typeof Lock; color: string; bar: string }> = {
  delivery: { icon: Lock, color: 'text-cyan-400', bar: 'bg-cyan-400' },
  craft: { icon: Medal, color: 'text-cyan-300', bar: 'bg-cyan-300' },
  tempo: { icon: Timer, color: 'text-teal-400', bar: 'bg-teal-400' },
  thrift: { icon: Scissors, color: 'text-success', bar: 'bg-success' },
  greed: { icon: Flame, color: 'text-primary', bar: 'bg-primary' },
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
        {AXIS_NAMES.map((name, i) => {
          const style = AXIS_STYLE[name];
          const Icon = style.icon;
          const earned = axes[name];
          const ceiling = axes.ceilings[name];
          // A ceiling of zero means the map never offered this axis; show it as
          // empty rather than dividing by nothing.
          const fill = ceiling > 0 ? Math.min(1, earned / ceiling) : 0;
          const spent = earned > 0;

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
                className={`text-xs font-bold tabular-nums w-[3.5rem] text-right shrink-0 ${
                  spent ? style.color : 'text-muted-foreground'
                }`}
              >
                {earned}/{ceiling}h
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
