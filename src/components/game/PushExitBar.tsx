/**
 * The way out of a push.
 *
 * Taking the push hands the board back with no visible way to stop, and the
 * only ends the player could see were locking every ball or failing. On a map
 * where the last ball cannot be sealed that is a dead run: cutting at a board
 * that will never finish, with hours already earned and no way to take them.
 *
 * An exit did exist before this - a thin outline strip at 10% accent opacity,
 * sandwiched in the bottom stack between the ability bar and the countdown
 * bars. It was reported as missing, which is the only review that matters. So
 * it is now the loudest thing on the screen that is not the board: solid fill,
 * full width, and it says what you are about to walk away with.
 *
 * The hours come from pushBonusEarned, the same function that computes the
 * actual payout. A button that worked the number out for itself would be free
 * to promise an hour the results screen then declines to hand over.
 */
import { useTranslation } from 'react-i18next';
import { Landmark } from 'lucide-react';

interface Props {
  /** Hours this push has banked so far. */
  bonusSoFar: number;
  onBank: () => void;
  accentColor: string;
}

export function PushExitBar({ bonusSoFar, onBank, accentColor }: Props) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-auto px-3 pb-2">
      <button
        onClick={onBank}
        className="w-full max-w-4xl mx-auto flex items-center justify-center gap-2 rounded-lg py-3 text-base font-bold shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{
          backgroundColor: accentColor,
          // Dark ink on the accent, matching the prompt's own Bank button:
          // the accent is a bright board colour and light text on it is the
          // one combination that disappears in sunlight.
          color: '#04140b',
          boxShadow: `0 0 20px ${accentColor}66`,
        }}
      >
        <Landmark className="w-5 h-5" />
        {t('pushYourLuck.bankAndContinue')}
        {/* Only once there is something to show. "+0h" on a push that has not
            yet cleared a chunk reads as "this button pays nothing", which is
            the opposite of the truth: the map's own score is already safe. */}
        {bonusSoFar > 0 && (
          <span className="tabular-nums">
            {t('pushYourLuck.bankedSoFar', { hours: bonusSoFar })}
          </span>
        )}
      </button>
    </div>
  );
}
