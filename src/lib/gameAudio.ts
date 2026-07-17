// Game Audio System
// Lightweight procedural sound effects using Web Audio API

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;
let sfxVolume = 1; // 0..1 master level for sound effects (music is separate)

// Ball-to-ball collisions can fire many times per physics step when several
// balls cluster in a shrinking region. Each playBallCollideSound call allocates
// ~6 oscillators + biquad filters + gain nodes; unthrottled on a low-end Android
// audio thread this storms the graph and churns GC, producing crackle and frame
// hitches. Gate to at most one collision blip per MIN_COLLIDE_INTERVAL_MS — a
// dropped near-simultaneous blip is inaudible, the storm is not.
const MIN_COLLIDE_INTERVAL_MS = 25;
let lastCollideTime = -Infinity;

// Volume settings
const VOLUME = {
  wallHit: 0.12,
  ballCollide: 0.07,
  fenceBreak: 0.18,
  death: 0.24,
};

// Everything above this gets rolled off by the master low-pass; procedural
// effects otherwise carry piercing energy right up to Nyquist.
const MASTER_LOWPASS_HZ = 3800;

/**
 * Initialize the audio context (must be called after user interaction)
 */
function ensureAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      const AudioCtx: typeof AudioContext | undefined =
        window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      // Gentle master low-pass so effects sit softer against the music
      const softener = audioContext.createBiquadFilter();
      softener.type = 'lowpass';
      softener.frequency.value = MASTER_LOWPASS_HZ;
      softener.Q.value = 0.5; // shallow slope, no resonant peak
      masterGain.connect(softener);
      softener.connect(audioContext.destination);
      masterGain.gain.value = isMuted ? 0 : sfxVolume;
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

  const nowMs = performance.now();
  if (nowMs - lastCollideTime < MIN_COLLIDE_INTERVAL_MS) return;
  lastCollideTime = nowMs;

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
    
    // Rounded attack (a hard 1ms edge reads as harsh), long sustaining decay
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(partialVolume, now + 0.006);
    gain.gain.setValueAtTime(partialVolume, now + 0.007);
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
  shimmerGain.gain.linearRampToValueAtTime(volume * 0.08, now + 0.006);
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
  
  crackGain.gain.setValueAtTime(0, now);
  crackGain.gain.linearRampToValueAtTime(volume, now + 0.006);
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
 * Play the ball-lock sequence: 3 rising pulses → electrical discharge flood → soft settle.
 * Total duration ~1.3s, matching LOCK_PULSE + LOCK_FLOOD + LOCK_FADE.
 */
export function playBallLockSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;

  const now = ctx.currentTime;
  const vol = 0.22;

  // --- Phase 1: 3 rising resonant pulses at 0 / 200 / 400 ms ---
  [0, 0.2, 0.4].forEach((delay, i) => {
    const t = now + delay;
    const freq = 280 + i * 90; // 280 → 370 → 460 Hz

    const osc = ctx.createOscillator();
    const flt = ctx.createBiquadFilter();
    const gn  = ctx.createGain();

    flt.type = 'bandpass';
    flt.frequency.value = freq;
    flt.Q.value = 10;

    osc.type = 'sine';
    osc.frequency.value = freq;

    osc.connect(flt); flt.connect(gn); gn.connect(masterGain!);

    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    osc.start(t);
    osc.stop(t + 0.16);

    // Subtle noise click behind each blip
    const nb  = createNoiseBuffer(ctx, 0.05);
    const ns  = ctx.createBufferSource();
    const nf  = ctx.createBiquadFilter();
    const ng  = ctx.createGain();
    ns.buffer = nb;
    nf.type = 'bandpass'; nf.frequency.value = freq * 1.5; nf.Q.value = 3;
    ns.connect(nf); nf.connect(ng); ng.connect(masterGain!);
    ng.gain.setValueAtTime(vol * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    ns.start(t); ns.stop(t + 0.06);
  });

  // --- Phase 2: electrical discharge at 600 ms (flood fill) ---
  const ft = now + 0.6;

  // Sweeping noise burst
  const nb2 = createNoiseBuffer(ctx, 0.42);
  const ns2 = ctx.createBufferSource();
  const nf2 = ctx.createBiquadFilter();
  const ng2 = ctx.createGain();
  ns2.buffer = nb2;
  nf2.type = 'bandpass';
  nf2.frequency.setValueAtTime(2200, ft);
  nf2.frequency.exponentialRampToValueAtTime(260, ft + 0.38);
  nf2.Q.value = 2;
  ns2.connect(nf2); nf2.connect(ng2); ng2.connect(masterGain!);
  ng2.gain.setValueAtTime(0, ft);
  ng2.gain.linearRampToValueAtTime(vol * 0.9, ft + 0.015);
  ng2.gain.exponentialRampToValueAtTime(0.001, ft + 0.38);
  ns2.start(ft); ns2.stop(ft + 0.42);

  // Descending tone sweep
  const sw  = ctx.createOscillator();
  const swg = ctx.createGain();
  sw.type = 'sawtooth';
  sw.frequency.setValueAtTime(520, ft);
  sw.frequency.exponentialRampToValueAtTime(110, ft + 0.38);
  sw.connect(swg); swg.connect(masterGain!);
  swg.gain.setValueAtTime(0, ft);
  swg.gain.linearRampToValueAtTime(vol * 0.35, ft + 0.01);
  swg.gain.exponentialRampToValueAtTime(0.001, ft + 0.42);
  sw.start(ft); sw.stop(ft + 0.45);

  // --- Phase 3: soft resonant settle at 980 ms ---
  const st = now + 0.98;
  const sl  = ctx.createOscillator();
  const slf = ctx.createBiquadFilter();
  const slg = ctx.createGain();
  slf.type = 'bandpass'; slf.frequency.value = 200; slf.Q.value = 8;
  sl.type = 'sine'; sl.frequency.value = 200;
  sl.connect(slf); slf.connect(slg); slg.connect(masterGain!);
  slg.gain.setValueAtTime(vol * 0.45, st);
  slg.gain.exponentialRampToValueAtTime(0.001, st + 0.3);
  sl.start(st); sl.stop(st + 0.35);
}

/** Quick territorial "swoosh + ding" when a cut successfully claims space. */
export function playCutClaimedSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  const now = ctx.currentTime;
  const vol = 0.14;

  // Rising noise sweep — air being captured
  const nb = createNoiseBuffer(ctx, 0.15);
  const ns = ctx.createBufferSource();
  const nf = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  ns.buffer = nb;
  nf.type = "bandpass";
  nf.frequency.setValueAtTime(800, now);
  nf.frequency.exponentialRampToValueAtTime(3200, now + 0.12);
  nf.Q.value = 2;
  ns.connect(nf); nf.connect(ng); ng.connect(masterGain);
  ng.gain.setValueAtTime(0, now);
  ng.gain.linearRampToValueAtTime(vol, now + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  ns.start(now); ns.stop(now + 0.18);

  // Bright confirmation tone rising quickly
  const osc = ctx.createOscillator();
  const ogn = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now + 0.04);
  osc.frequency.linearRampToValueAtTime(1320, now + 0.10);
  osc.connect(ogn); ogn.connect(masterGain);
  ogn.gain.setValueAtTime(0, now + 0.04);
  ogn.gain.linearRampToValueAtTime(vol * 0.7, now + 0.06);
  ogn.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.start(now + 0.04); osc.stop(now + 0.28);
}

/**
 * The pickup-claimed jingle (issue #48: "short but memorable"): a quick
 * major-arpeggio fanfare (E5-G#5-B5-E6) with a bell layer an octave up on the
 * last note and a sparkle tail. ~0.45s total, unmistakably "you won a prize".
 */
export function playPickupClaimedSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  const now = ctx.currentTime;
  const vol = 0.15;

  // Fast ascending E-major arpeggio; each note a sine + quiet triangle layer
  // (the triangle's odd harmonics give it a music-box edge).
  const NOTES: Array<[number, number, number]> = [
    [659.3, 0, 0.8],     // E5
    [830.6, 0.055, 0.85], // G#5
    [987.8, 0.11, 0.9],   // B5
    [1318.5, 0.165, 1],   // E6 — the landing note rings longest
  ];
  for (const [freq, delay, gain] of NOTES) {
    const t = now + delay;
    const ring = delay >= 0.16 ? 0.5 : 0.22;
    for (const [type, mul, g] of [["sine", 1, 1], ["triangle", 1, 0.35]] as const) {
      const osc = ctx.createOscillator();
      const gn = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mul;
      osc.connect(gn); gn.connect(masterGain!);
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(vol * gain * g, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.001, t + ring);
      osc.start(t); osc.stop(t + ring + 0.02);
    }
  }

  // Bell shimmer an octave above the landing note.
  const bell = ctx.createOscillator();
  const bg = ctx.createGain();
  bell.type = "sine";
  bell.frequency.value = 2637; // E7
  bell.connect(bg); bg.connect(masterGain);
  bg.gain.setValueAtTime(0, now + 0.165);
  bg.gain.linearRampToValueAtTime(vol * 0.35, now + 0.18);
  bg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  bell.start(now + 0.165); bell.stop(now + 0.52);

  // Sparkle tail.
  const nb = createNoiseBuffer(ctx, 0.25);
  const ns = ctx.createBufferSource();
  const nf = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  ns.buffer = nb;
  nf.type = "highpass"; nf.frequency.value = 6000;
  ns.connect(nf); nf.connect(ng); ng.connect(masterGain);
  ng.gain.setValueAtTime(vol * 0.3, now + 0.16);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
  ns.start(now + 0.16); ns.stop(now + 0.45);
}

/** Rising pitch sweep — energy spinning up — when the level is cleared. */
export function playLevelCompleteSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx || !masterGain || isMuted) return;
  const now = ctx.currentTime;
  const vol = 0.18;

  // Two slightly-detuned sine oscillators sweep 100 Hz → 1200 Hz for width
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const flt  = ctx.createBiquadFilter();
  const gn   = ctx.createGain();
  osc1.type = "sine"; osc2.type = "sine";
  osc1.frequency.setValueAtTime(100, now);
  osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.65);
  osc2.frequency.setValueAtTime(103, now);
  osc2.frequency.exponentialRampToValueAtTime(1236, now + 0.65);
  flt.type = "lowpass";
  flt.frequency.setValueAtTime(300, now);
  flt.frequency.exponentialRampToValueAtTime(8000, now + 0.65);
  flt.Q.value = 2;
  osc1.connect(flt); osc2.connect(flt); flt.connect(gn); gn.connect(masterGain!);
  gn.gain.setValueAtTime(0, now);
  gn.gain.linearRampToValueAtTime(vol, now + 0.45);
  gn.gain.exponentialRampToValueAtTime(vol * 0.3, now + 0.65);
  gn.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
  osc1.start(now); osc1.stop(now + 0.9);
  osc2.start(now); osc2.stop(now + 0.9);

  // Bandpass noise sweeps up alongside — adds a spinning/rushing texture
  const nb = createNoiseBuffer(ctx, 0.7);
  const ns = ctx.createBufferSource();
  const nf = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  ns.buffer = nb;
  nf.type = "bandpass";
  nf.frequency.setValueAtTime(200, now);
  nf.frequency.exponentialRampToValueAtTime(4000, now + 0.6);
  nf.Q.value = 3;
  ns.connect(nf); nf.connect(ng); ng.connect(masterGain!);
  ng.gain.setValueAtTime(0, now);
  ng.gain.linearRampToValueAtTime(vol * 0.35, now + 0.3);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  ns.start(now); ns.stop(now + 0.75);
}

/**
 * Set mute state
 */
export function setAudioMuted(muted: boolean): void {
  isMuted = muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : sfxVolume;
  }
}

/** Set the sound-effects master volume (0..1). Music volume is separate. */
export function setSfxVolume(volume: number): void {
  sfxVolume = Math.max(0, Math.min(1, volume));
  if (masterGain && !isMuted) {
    masterGain.gain.value = sfxVolume;
  }
}

/** Current sound-effects master volume (0..1). */
export function getSfxVolume(): number {
  return sfxVolume;
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
