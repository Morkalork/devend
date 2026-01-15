export interface Highscore {
  name: string;       // 1-6 letters, A-Z only, uppercase
  level: number;      // highest level reached (integer)
  totalScore: number; // run total score (integer)
  dateTime: string;   // ISO timestamp
}

export const HIGHSCORES_STORAGE_KEY = 'ball_breaker_highscores';
export const LAST_NAME_STORAGE_KEY = 'ball_breaker_last_name';
export const MAX_HIGHSCORES = 50;
