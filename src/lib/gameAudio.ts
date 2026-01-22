// Game Audio System
// Lightweight procedural sound effects using Web Audio API

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

// Volume settings
const VOLUME = {
  wallHit: 0.15,
  ballCollide: 0.18,
  fenceBreak: 0.25,
  death: 0.3,
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
 * Play a triangle-instrument-like "pling" for ball-to-ball collisions
 * Bright, metallic, sustaining ring with inharmonic partials
 */
export function playBallCollideSound(intensity: number = 0.5): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  
  const now = ctx.currentTime;
  const volume = VOLUME.ballCollide * Math.min(1, Math.max(0.3, intensity));
  
  // Triangle instruments have inharmonic partials (not exact integer ratios)
  // Fundamental around 880Hz (A5) with characteristic triangle overtones
  const fundamentalFreq = 880 + (Math.random() - 0.5) * 40; // Slight variation
  
  // Triangle partial ratios (inharmonic for that metallic quality)
  const partials = [
    { ratio: 1.0, amp: 1.0, decay: 0.8 },      // Fundamental
    { ratio: 2.76, amp: 0.5, decay: 0.6 },     // Inharmonic 2nd
    { ratio: 5.4, amp: 0.25, decay: 0.4 },     // Inharmonic 3rd
    { ratio: 8.93, amp: 0.12, decay: 0.25 },   // Inharmonic 4th
  ];
  
  partials.forEach((partial) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    
    // High-pass to remove low rumble, keeping it bright
    highpass.type = 'highpass';
    highpass.frequency.value = 400;
    
    osc.type = 'sine';
    osc.frequency.value = fundamentalFreq * partial.ratio;
    
    osc.connect(highpass);
    highpass.connect(gain);
    gain.connect(masterGain);
    
    const partialVolume = volume * partial.amp;
    const decayTime = partial.decay;
    
    // Sharp attack, long sustaining decay (triangle characteristic)
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(partialVolume, now + 0.001);
    gain.gain.setValueAtTime(partialVolume, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(partialVolume * 0.3, now + decayTime * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime);
    
    osc.start(now);
    osc.stop(now + decayTime + 0.05);
  });
  
  // Add subtle shimmer/beating with slightly detuned pair
  const shimmer1 = ctx.createOscillator();
  const shimmer2 = ctx.createOscillator();
  const shimmerGain = ctx.createGain();
  
  shimmer1.type = 'sine';
  shimmer2.type = 'sine';
  shimmer1.frequency.value = fundamentalFreq * 2.76;
  shimmer2.frequency.value = fundamentalFreq * 2.76 + 3; // Slight detune for beating
  
  shimmer1.connect(shimmerGain);
  shimmer2.connect(shimmerGain);
  shimmerGain.connect(masterGain);
  
  shimmerGain.gain.setValueAtTime(0, now);
  shimmerGain.gain.linearRampToValueAtTime(volume * 0.08, now + 0.001);
  shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  
  shimmer1.start(now);
  shimmer2.start(now);
  shimmer1.stop(now + 0.55);
  shimmer2.stop(now + 0.55);
}

/**
 * Play a breaking/shattering sound when fence is destroyed by ball
 * Harsh, percussive crack with falling debris
 */
export function playFenceBreakSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  
  const now = ctx.currentTime;
  const volume = VOLUME.fenceBreak;
  
  // Initial crack - short noise burst
  const crackBuffer = createNoiseBuffer(ctx, 0.1);
  const crackSource = ctx.createBufferSource();
  const crackGain = ctx.createGain();
  const crackFilter = ctx.createBiquadFilter();
  
  crackSource.buffer = crackBuffer;
  crackFilter.type = 'bandpass';
  crackFilter.frequency.value = 2000;
  crackFilter.Q.value = 1;
  
  crackSource.connect(crackFilter);
  crackFilter.connect(crackGain);
  crackGain.connect(masterGain);
  
  crackGain.gain.setValueAtTime(volume, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  
  crackSource.start(now);
  crackSource.stop(now + 0.1);
  
  // Low thump for impact
  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150, now);
  thump.frequency.exponentialRampToValueAtTime(50, now + 0.1);
  
  thump.connect(thumpGain);
  thumpGain.connect(masterGain);
  
  thumpGain.gain.setValueAtTime(0, now);
  thumpGain.gain.linearRampToValueAtTime(volume * 0.6, now + 0.005);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  
  thump.start(now);
  thump.stop(now + 0.2);
  
  // Debris/shatter tail - filtered noise
  const debrisBuffer = createNoiseBuffer(ctx, 0.25);
  const debrisSource = ctx.createBufferSource();
  const debrisGain = ctx.createGain();
  const debrisFilter = ctx.createBiquadFilter();
  
  debrisSource.buffer = debrisBuffer;
  debrisFilter.type = 'highpass';
  debrisFilter.frequency.value = 1500;
  
  debrisSource.connect(debrisFilter);
  debrisFilter.connect(debrisGain);
  debrisGain.connect(masterGain);
  
  debrisGain.gain.setValueAtTime(0, now);
  debrisGain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.02);
  debrisGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  
  debrisSource.start(now);
  debrisSource.stop(now + 0.25);
}

/**
 * Play a dramatic death/game over sound
 * Descending tones with impact
 */
export function playDeathSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  
  const now = ctx.currentTime;
  const volume = VOLUME.death;
  
  // Descending tone - ominous drop
  const drop = ctx.createOscillator();
  const dropGain = ctx.createGain();
  const dropFilter = ctx.createBiquadFilter();
  
  dropFilter.type = 'lowpass';
  dropFilter.frequency.value = 800;
  
  drop.type = 'sawtooth';
  drop.frequency.setValueAtTime(400, now);
  drop.frequency.exponentialRampToValueAtTime(80, now + 0.4);
  
  drop.connect(dropFilter);
  dropFilter.connect(dropGain);
  dropGain.connect(masterGain);
  
  dropGain.gain.setValueAtTime(0, now);
  dropGain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.01);
  dropGain.gain.setValueAtTime(volume * 0.5, now + 0.3);
  dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  
  drop.start(now);
  drop.stop(now + 0.65);
  
  // Impact boom
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  
  boom.type = 'sine';
  boom.frequency.setValueAtTime(80, now + 0.05);
  boom.frequency.exponentialRampToValueAtTime(30, now + 0.4);
  
  boom.connect(boomGain);
  boomGain.connect(masterGain);
  
  boomGain.gain.setValueAtTime(0, now);
  boomGain.gain.linearRampToValueAtTime(volume * 0.7, now + 0.06);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  
  boom.start(now);
  boom.stop(now + 0.55);
  
  // Noise crash
  const crashBuffer = createNoiseBuffer(ctx, 0.3);
  const crashSource = ctx.createBufferSource();
  const crashGain = ctx.createGain();
  const crashFilter = ctx.createBiquadFilter();
  
  crashSource.buffer = crashBuffer;
  crashFilter.type = 'lowpass';
  crashFilter.frequency.setValueAtTime(3000, now);
  crashFilter.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  
  crashSource.connect(crashFilter);
  crashFilter.connect(crashGain);
  crashGain.connect(masterGain);
  
  crashGain.gain.setValueAtTime(0, now);
  crashGain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.02);
  crashGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  
  crashSource.start(now);
  crashSource.stop(now + 0.4);
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
