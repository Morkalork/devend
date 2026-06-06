/**
 * CRT Post-FX Pipeline — Phaser WebGL post-processing effect.
 *
 * Simulates a CRT monitor with:
 * - Phosphor bloom (red/green/blue channel separation with glow)
 * - Scanlines (horizontal TV lines)
 * - Neon rim light (chromatic aberration edge highlight)
 */
import Phaser from 'phaser';

const CRT_VERTEX_SHADER = `
#define SHADER_NAME CRT_VS

precision mediump float;

uniform mat4 uProjectionMatrix;

attribute vec2 inPosition;
attribute vec2 inTexCoord;

varying vec2 outTexCoord;

void main() {
  gl_Position = uProjectionMatrix * vec4(inPosition, 0.0, 1.0);
  outTexCoord = inTexCoord;
}
`;

const CRT_FRAGMENT_SHADER = `
#define SHADER_NAME CRT_FS

precision mediump float;

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uIntensity;

varying vec2 outTexCoord;

void main() {
  vec2 uv = outTexCoord;

  // Sample the centre once and reuse it for the green channel + bloom glow;
  // only the chromatic red/blue need offset samples (3 fetches total, not 5).
  vec3 center = texture2D(uMainSampler, uv).rgb;
  float r = texture2D(uMainSampler, uv + vec2(0.002, 0.0)).r;
  float b = texture2D(uMainSampler, uv - vec2(0.002, 0.0)).b;

  vec3 bloom = vec3(r, center.g, b);

  // Scanlines: horizontal stripes
  float scanline = sin(uv.y * 600.0) * 0.5 + 0.5;
  scanline = mix(1.0, scanline, 0.3);

  // Apply bloom glow (reuse the centre sample)
  bloom += center * 0.3;
  bloom = clamp(bloom, 0.0, 1.0);

  // Neon rim: edge highlight with slight glow
  vec2 edge = abs(uv - vec2(0.5, 0.5)) * 2.0;
  float rim = 1.0 - (edge.x * edge.x + edge.y * edge.y) * 0.5;
  rim = max(0.0, rim);
  vec3 neonRim = vec3(0.0, 1.0, 0.5) * rim * 0.2;

  // Combine effects
  vec3 final = bloom * scanline + neonRim;

  // Subtle vignette
  vec2 vigPos = abs(uv - 0.5) * 2.0;
  float vignette = 1.0 - (vigPos.x * vigPos.x + vigPos.y * vigPos.y) * 0.3;
  final *= vignette;

  gl_FragColor = vec4(final, 1.0);
}
`;

export function addCRTPipeline(game: Phaser.Game): void {
  const renderer = game.renderer;
  if (renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
    const pipeline = new CRTPipeline(game);
    renderer.pipelines.addPostPipeline('crt', pipeline);
  }
}

export class CRTPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private uTime = 0;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'crt',
      vertexShader: CRT_VERTEX_SHADER,
      fragmentShader: CRT_FRAGMENT_SHADER,
    });
  }

  onUpdate(): void {
    this.uTime += 0.016;
    this.set1f('uTime', this.uTime);
    this.set1f('uIntensity', 1.0);
  }
}

/**
 * Apply CRT effect to camera (scene-wide).
 */
export function applyCRTEffect(scene: Phaser.Scene): void {
  scene.cameras.main.setPostPipeline('crt');
}

/**
 * Remove CRT effect from camera.
 */
export function removeCRTEffect(scene: Phaser.Scene): void {
  scene.cameras.main.removePostPipeline('crt');
}
