// Game Audio System
// Lightweight procedural sound effects using Web Audio API

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

// Volume settings
const VOLUME = {
  wallHit: 0.15,
  ballCollide: 0.2,
};

/**
 * Initialize the audio context (must be called after user interaction)
 */
function ensureAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);
      masterGain.gain.value = isMuted ? 0 : 1;
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
      return null;
    }
  }
  
  // Resume if suspended (browsers require user interaction)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
}

/**
 * Play a "thud" sound for wall collisions
 * Low-frequency impact with quick decay
 */
export function playWallHitSound(intensity: number = 0.5): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  
  const now = ctx.currentTime;
  const volume = VOLUME.wallHit * Math.min(1, Math.max(0.3, intensity));
  
  // Create oscillator for low thud
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  
  // Low-pass filter for muffled thud
  filter.type = 'lowpass';
  filter.frequency.value = 200;
  filter.Q.value = 1;
  
  oscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(masterGain);
  
  // Thud: quick pitch drop
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(120, now);
  oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.08);
  
  // Quick attack, fast decay
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  
  oscillator.start(now);
  oscillator.stop(now + 0.15);
  
  // Add a noise burst for texture
  const noiseBuffer = createNoiseBuffer(ctx, 0.05);
  const noiseSource = ctx.createBufferSource();
  const noiseGain = ctx.createGain();
  const noiseFilter = ctx.createBiquadFilter();
  
  noiseSource.buffer = noiseBuffer;
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 300;
  
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  
  noiseGain.gain.setValueAtTime(volume * 0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  
  noiseSource.start(now);
  noiseSource.stop(now + 0.08);
}

/**
 * Play a "kling" sound for ball-to-ball collisions
 * Higher pitched metallic/glass-like ping
 */
export function playBallCollideSound(intensity: number = 0.5): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  
  const now = ctx.currentTime;
  const volume = VOLUME.ballCollide * Math.min(1, Math.max(0.3, intensity));
  
  // Primary tone - higher frequency ping
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, now); // A5
  osc1.frequency.exponentialRampToValueAtTime(660, now + 0.1);
  
  osc1.connect(gain1);
  gain1.connect(masterGain);
  
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(volume, now + 0.002);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  
  osc1.start(now);
  osc1.stop(now + 0.2);
  
  // Harmonic overtone for metallic quality
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1760, now); // A6 (octave above)
  osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
  
  osc2.connect(gain2);
  gain2.connect(masterGain);
  
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(volume * 0.4, now + 0.001);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  
  osc2.start(now);
  osc2.stop(now + 0.15);
  
  // Third harmonic for shimmer
  const osc3 = ctx.createOscillator();
  const gain3 = ctx.createGain();
  
  osc3.type = 'sine';
  osc3.frequency.setValueAtTime(2640, now); // E7
  
  osc3.connect(gain3);
  gain3.connect(masterGain);
  
  gain3.gain.setValueAtTime(0, now);
  gain3.gain.linearRampToValueAtTime(volume * 0.15, now + 0.001);
  gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  
  osc3.start(now);
  osc3.stop(now + 0.1);
}

/**
 * Create a buffer of white noise
 */
function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  return buffer;
}

/**
 * Set mute state
 */
export function setAudioMuted(muted: boolean): void {
  isMuted = muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : 1;
  }
}

/**
 * Get current mute state
 */
export function isAudioMuted(): boolean {
  return isMuted;
}

/**
 * Initialize audio on user interaction
 * Call this early (e.g., on first click/touch)
 */
export function initAudio(): void {
  ensureAudioContext();
}
