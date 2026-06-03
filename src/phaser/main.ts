/**
 * Phaser bootstrap — Phase 0/1 scaffold.
 *
 * Mounts a Phaser game using Phaser.AUTO (WebGL with Canvas fallback) and the
 * Matter physics engine, scaled to the existing logical world (BOARD_WIDTH x
 * BOARD_HEIGHT) via Scale.FIT so world coordinates from the existing engine
 * map 1:1 into the scene.
 *
 * Phase 1 boots through BootScene (YAML loading + texture baking) → MenuScene,
 * with SpikeScene available for verification.
 *
 * Runs in parallel with the React build behind `?phaser=1` (see src/main.tsx).
 */
import Phaser from "phaser";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { SpikeScene } from "./scenes/SpikeScene";

export function startPhaser(parentId = "phaser-root"): Phaser.Game {
  let parent = document.getElementById(parentId);
  if (!parent) {
    parent = document.createElement("div");
    parent.id = parentId;
    document.body.appendChild(parent);
  }

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    backgroundColor: "#0a0a0a",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
    },
    physics: {
      default: "matter",
      matter: {
        gravity: { x: 0, y: 0 },
        debug: true,
        positionIterations: 12,
        velocityIterations: 8,
      },
    },
    scene: [BootScene, MenuScene, SpikeScene],
  });
}
