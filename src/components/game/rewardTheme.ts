/**
 * The colour an assignment reward wears, from the summary through to the pick.
 *
 * One constant rather than the hex written out at each site, because the two
 * screens have to LOOK connected: you are told what you earned on one and you
 * take it on the next, and if they wear different colours the second reads as a
 * different part of the game rather than the payoff of the first. That is the
 * fault it is here to prevent, not a tidiness preference.
 *
 * Deliberately not the run's accent. The accent is the player's own colour (it
 * marks their fences, and a boss map re-skins it to danger red); a reward is
 * something the game hands over, and wearing the player's colour would read as
 * something they did rather than something they got.
 */
export const REWARD_GOLD = '#ffd54a';

/** The same gold at the alphas the reward surfaces use. */
export const REWARD_GOLD_BORDER = `${REWARD_GOLD}66`;
export const REWARD_GOLD_FILL = `${REWARD_GOLD}12`;
export const REWARD_GOLD_GLOW = `${REWARD_GOLD}55`;
