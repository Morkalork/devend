/**
 * The 3D frame's last step: HDR scene in, display-ready texture out.
 *
 * three.js only tone-maps and sRGB-encodes when it draws to the screen, and
 * this renderer never does - its frame goes into a texture the Pixi
 * compositor shows (textureBridge.ts) - so the final conversion is done here,
 * in one full-screen pass.
 *
 * THE CURVE IS A SHOULDER, NOT A FILMIC CURVE. ACES and AgX both reshape the
 * whole range: they would darken and desaturate the board's carefully picked
 * colours everywhere, which is a different game. This passes everything below
 * the knee through untouched, so a surface lit at its normal level shows the
 * palette exactly, and rolls off only what is brighter than that - an
 * explosion's core, a lamp's hot spot, the floor under a lock flash - into the
 * top of the range instead of clipping it flat. Applied to the brightest
 * channel and scaled through, so a hot colour keeps its hue as it saturates.
 *
 * The scene is rendered over transparent black (the page shows through the
 * board's translucent surface), so its colour arrives premultiplied; it is
 * divided out before the curve and multiplied back after.
 */
import {
  Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, type Texture,
  type WebGLRenderTarget, type WebGLRenderer,
} from "three";

/** Below this, linear values pass straight through. */
export const SHOULDER_KNEE = 0.72;

/** The shoulder, in JS, for the test that pins it. */
export function shoulder(x: number, knee = SHOULDER_KNEE): number {
  if (x <= knee) return x;
  const span = 1 - knee;
  return knee + span * (1 - Math.exp(-(x - knee) / span));
}

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
uniform sampler2D tScene;
uniform float uKnee;
varying vec2 vUv;
float shoulder(float x) {
  if (x <= uKnee) return x;
  float span = 1.0 - uKnee;
  return uKnee + span * (1.0 - exp(-(x - uKnee) / span));
}
vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec4 s = texture2D(tScene, vUv);
  float a = clamp(s.a, 0.0, 1.0);
  vec3 c = a > 0.0001 ? s.rgb / a : s.rgb;
  float m = max(max(c.r, c.g), c.b);
  if (m > uKnee) c *= shoulder(m) / m;
  c = encode(clamp(c, 0.0, 1.0));
  // Additive light (an explosion's core) can land where the scene is clear.
  float outA = max(a, clamp(max(max(s.r, s.g), s.b), 0.0, 1.0));
  gl_FragColor = vec4(c * outA, outA);
}
`;

export class OutputPass {
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: ShaderMaterial;
  private quad: Mesh;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tScene: { value: null }, uKnee: { value: SHOULDER_KNEE } },
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  render(renderer: WebGLRenderer, input: Texture, output: WebGLRenderTarget): void {
    this.material.uniforms.tScene.value = input;
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
