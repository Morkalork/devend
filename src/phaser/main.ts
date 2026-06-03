/**
 * Phaser bootstrap — Phase 0 scaffold.
 *
 * Mounts a Phaser game using Phaser.AUTO (WebGL with Canvas fallback) and the
 * Matter physics engine, scaled to the existing logical world (BOARD_WIDTH x
 * BOARD_HEIGHT) via Scale.FIT so world coordinates from the existing engine
 * map 1:1 into the scene.
 *
 * Runs in parallel with the React build behind `?phaser=1` (see src/main.tsx)
 * so each migration phase can be verified side-by-side.
 */
import Phaser from "phaser";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
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
        // Phase 0: debug draw on so the spike is inspectable in the browser.
        debug: true,
        // Tighter solver iterations reduce tunneling at high ball speeds.
        // (See SpikeScene gate criterion #2.)
        positionIterations: 12,
        velocityIterations: 8,
      },
    },
    scene: [SpikeScene],
  });
}
