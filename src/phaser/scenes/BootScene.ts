/**
 * BootScene — Phase 1: Phaser boot and asset baking.
 *
 * Responsibilities:
 *   1. Load all YAML configuration files (game-config, colors, etc.)
 *   2. Parse them with framework-agnostic utilities
 *   3. Bake procedural textures (ball base/specular, board patterns)
 *   4. Show progress bar and status messages
 *   5. Launch into MenuScene once ready
 *
 * This scene runs once per game instance and populates the texture manager
 * with all assets the gameplay scenes need.
 */
import Phaser from 'phaser';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import { parseGameConfig, parseColorsYml, loadYamlFile, GameConfig } from '../utils/yaml-parser';
import { bakeBallTextures, bakeHexOverlay } from '../utils/textures';

export class BootScene extends Phaser.Scene {
  private progressBar: Phaser.GameObjects.Graphics | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private progress = 0;

  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Setup progress display
    this.setupProgressUI();

    // Load YAML files (via Phaser's loader to integrate with progress)
    this.load.text('game-config', '/game-config.yml');
    this.load.text('colors', '/colors.yml');
    this.load.text('map', '/map.yml');
    this.load.text('scoring-config', '/scoring-config.yml');
    this.load.text('upgrades', '/upgrades.yml');
    this.load.text('certificates', '/certificates.yml');
    this.load.text('achievements', '/achievements.yml');

    // Progress events
    this.load.on('progress', (value: number) => {
      this.progress = value * 50; // First 50% is loading
      this.updateProgressUI();
    });

    this.load.on('filecomplete', (key: string) => {
      this.statusText?.setText(`Loaded: ${key}`);
    });

    this.load.on('complete', () => {
      this.progress = 50;
      this.updateProgressUI();
    });
  }

  async create(): Promise<void> {
    try {
      // Parse configs
      this.updateStatus('Parsing YAML...');
      const gameConfigText = this.cache.text.get('game-config');
      const colorsText = this.cache.text.get('colors');

      const gameConfig = await parseGameConfig(gameConfigText);
      const colors = await parseColorsYml(colorsText);

      // Store in registry for other scenes to access
      this.registry.set('gameConfig', gameConfig);
      this.registry.set('colors', colors);

      // Bake textures
      this.updateStatus('Baking textures...');
      this.progress = 60;
      this.updateProgressUI();

      // Bake hex overlay
      bakeHexOverlay(this, `#${colors.accent}`);

      // Bake ball textures for each color in config
      const ballColors = Object.values(colors.balls || {});
      const colorStep = 40 / Math.max(ballColors.length, 1);

      for (const color of ballColors) {
        bakeBallTextures(this, color);
        this.progress += colorStep;
        this.updateProgressUI();
      }

      this.updateStatus('Ready! Starting...');
      this.progress = 100;
      this.updateProgressUI();

      // Small delay for visual clarity, then transition
      this.time.delayedCall(300, () => {
        this.scene.start('MenuScene');
      });
    } catch (err) {
      console.error('[BootScene] Error during boot:', err);
      this.updateStatus('Error during boot');
    }
  }

  private setupProgressUI(): void {
    const width = BOARD_WIDTH;
    const height = 60;
    const x = (this.cameras.main.width - width) / 2;
    const y = (this.cameras.main.height - height) / 2;

    // Background box
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a1a, 0.8);
    bg.fillRect(x - 10, y - 10, width + 20, height + 20);

    // Progress bar track
    this.progressBar = this.add.graphics();
    this.progressBar.fillStyle(0x00ff88, 0.2);
    this.progressBar.fillRect(x, y, width, height);

    // Status text
    this.statusText = this.add.text(x + width / 2, y + height + 20, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#00ff88',
    });
    this.statusText.setOrigin(0.5, 0);
  }

  private updateStatus(text: string): void {
    if (this.statusText) {
      this.statusText.setText(text);
    }
  }

  private updateProgressUI(): void {
    if (!this.progressBar) return;

    const width = BOARD_WIDTH;
    const height = 60;
    const x = (this.cameras.main.width - width) / 2;
    const y = (this.cameras.main.height - height) / 2;

    this.progressBar.clear();
    this.progressBar.fillStyle(0x00ff88, 0.2);
    this.progressBar.fillRect(x, y, width, height);

    this.progressBar.fillStyle(0x00ff88, 0.8);
    this.progressBar.fillRect(x, y, (width * this.progress) / 100, height);
  }
}
