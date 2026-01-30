import { useMemo } from 'react';
import { UpgradeConfig } from '@/types/upgrade';

export interface ActiveModifiers {
  // Multiplicative modifiers (product of all values)
  ballSpeedMultiplier: number;
  ballSizeMultiplier: number;
  wallSpeedMultiplier: number;
  
  // Additive modifiers (sum of all values)
  reducedSizePercent: number;
  wallGrace: number;
  swipeSensitivity: number;
  scoreMultiplier: number;
  expectedCutsBonus: number;
  shopSlots: number;
  wallShield: number;
  priceMultiplier: number;
  bonusLives: number; // Extra lives from upgrades
  
  // Dead balls: min and max spawned at level start
  minDeadBalls: number;
  maxDeadBalls: number;
  
  // Ball collision speed increase (bouncer effect)
  ballCollissionSpeedIncrease: number;
  
  // Yin Yang: random ball speed modifier
  randomBallSpeedModifier: number;
  
  // Boolean modifiers (OR of all values)
  cutPreview: boolean;
  highlightFastestBall: boolean;
  nonLinearLines: boolean;
}

export function useActiveModifiers(
  ownedUpgradeIds: string[],
  upgrades: UpgradeConfig[]
): ActiveModifiers {
  return useMemo(() => {
    // Initialize multiplicative modifiers to 1 (identity)
    let ballSpeedMultiplier = 1;
    let ballSizeMultiplier = 1;
    let wallSpeedMultiplier = 1;
    let priceMultiplier = 1;
    let scoreMultiplier = 1;
    
    // Initialize additive modifiers to 0
    let reducedSizePercent = 0;
    let wallGrace = 0;
    let swipeSensitivity = 1; // Base sensitivity
    let expectedCutsBonus = 0;
    let shopSlots = 0;
    let wallShield = 0;
    let bonusLives = 0;
    let minDeadBalls = 0;
    let maxDeadBalls = 0;
    let ballCollissionSpeedIncrease = 0;
    let randomBallSpeedModifier = 0;
    
    // Initialize boolean modifiers to false
    let cutPreview = false;
    let highlightFastestBall = false;
    let nonLinearLines = false;
    
    for (const upgradeId of ownedUpgradeIds) {
      const upgrade = upgrades.find(u => u.id === upgradeId);
      if (!upgrade?.modifiers) continue;
      
      const m = upgrade.modifiers;
      
      // Multiplicative modifiers
      if (m.ballSpeed !== undefined) {
        ballSpeedMultiplier *= m.ballSpeed;
      }
      if (m.ballSize !== undefined) {
        ballSizeMultiplier *= m.ballSize;
      }
      if (m.wallGenerationSpeed !== undefined) {
        wallSpeedMultiplier *= m.wallGenerationSpeed;
      }
      if (m.priceMultiplier !== undefined) {
        priceMultiplier *= m.priceMultiplier;
      }
      if (m.scoreMultiplier !== undefined) {
        scoreMultiplier *= m.scoreMultiplier;
      }
      
      // Additive modifiers
      if (m.reducedSize !== undefined) {
        reducedSizePercent += m.reducedSize * 100; // Convert 0.05 to 5%
      }
      if (m.wallGrace !== undefined) {
        wallGrace += m.wallGrace;
      }
      if (m.swipeSensitivity !== undefined) {
        swipeSensitivity *= m.swipeSensitivity;
      }
      if (m.expectedCutsBonus !== undefined) {
        expectedCutsBonus += m.expectedCutsBonus;
      }
      if (m.shopSlots !== undefined) {
        shopSlots += m.shopSlots;
      }
      if (m.wallShield !== undefined) {
        wallShield += m.wallShield;
      }
      if (m.lives !== undefined) {
        bonusLives += m.lives;
      }
      
      // Dead balls modifiers (take maximum values for range)
      if (m.minDeadBalls !== undefined) {
        minDeadBalls = Math.max(minDeadBalls, m.minDeadBalls);
      }
      if (m.maxDeadBalls !== undefined) {
        maxDeadBalls = Math.max(maxDeadBalls, m.maxDeadBalls);
      }
      
      // Ball collision speed increase (additive)
      if (m.ballCollissionSpeedIncrease !== undefined) {
        ballCollissionSpeedIncrease += m.ballCollissionSpeedIncrease;
      }
      
      // Random ball speed modifier (additive - can be negative for Yin Yang)
      if (m.randomBallSpeed !== undefined) {
        randomBallSpeedModifier += m.randomBallSpeed;
      }
      
      // Boolean modifiers
      if (m.cutPreview) {
        cutPreview = true;
      }
      if (m.highlightFastestBall) {
        highlightFastestBall = true;
      }
      if (m.nonLinearLines) {
        nonLinearLines = true;
      }
    }
    
    return {
      ballSpeedMultiplier,
      ballSizeMultiplier,
      wallSpeedMultiplier,
      reducedSizePercent,
      wallGrace,
      swipeSensitivity,
      scoreMultiplier,
      expectedCutsBonus,
      shopSlots,
      wallShield,
      priceMultiplier,
      bonusLives,
      minDeadBalls,
      maxDeadBalls,
      ballCollissionSpeedIncrease,
      randomBallSpeedModifier,
      cutPreview,
      highlightFastestBall,
      nonLinearLines,
    };
  }, [ownedUpgradeIds, upgrades]);
}
