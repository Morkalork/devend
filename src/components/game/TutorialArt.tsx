/**
 * TutorialArt — small, on-brand SVG illustrations for the help modals, drawn in
 * the game's own visual language (dark dot-grid board, bright accent fences,
 * glowing balls). Each is a self-contained square so it drops into any modal.
 */
import { ReactNode } from 'react';

const ACCENT = '#00ff88';
const VB = '0 0 150 120';

/** Shared board: dark region + faint dot grid + subtle outline. */
function Board({ children }: { children?: ReactNode }) {
  return (
    <svg width="150" height="120" viewBox={VB} fill="none" aria-hidden="true">
      <defs>
        <pattern id="ta-grid" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#2bff9e" opacity="0.1" />
        </pattern>
        <clipPath id="ta-board"><rect x="6" y="6" width="138" height="108" rx="12" /></clipPath>
      </defs>
      <g clipPath="url(#ta-board)">
        <rect x="6" y="6" width="138" height="108" fill="#0f2117" />
        <rect x="6" y="6" width="138" height="108" fill="url(#ta-grid)" />
        {children}
      </g>
      <rect x="6" y="6" width="138" height="108" rx="12" fill="none" stroke="#24422f" strokeWidth="2" />
    </svg>
  );
}

/** A glowing ball. */
function Ball({ x, y, r = 14, color = '#ff5a52' }: { x: number; y: number; r?: number; color?: string }) {
  return (
    <>
      <circle cx={x} cy={y} r={r + 6} fill={color} opacity="0.16" />
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x - r * 0.33} cy={y - r * 0.33} r={r * 0.28} fill="#ffffff" opacity="0.45" />
    </>
  );
}

/** LOCK — a ball fenced tight into a captured corner pocket. */
export function LockArt() {
  return (
    <Board>
      <rect x="6" y="63" width="52" height="51" fill={ACCENT} opacity="0.2" />
      <path d="M6 63 H58 V114" fill="none" stroke={ACCENT} strokeWidth="7" strokeLinecap="round" opacity="0.28" />
      <path d="M6 63 H58 V114" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <Ball x={32} y={89} r={16} />
    </Board>
  );
}

/** MOVER — an orange obstacle on a track; a ball bounces off it. */
export function MoverArt() {
  const O = '#ff8800';
  return (
    <Board>
      {/* track */}
      <line x1="20" y1="60" x2="130" y2="60" stroke={O} strokeWidth="2" strokeDasharray="4 5" opacity="0.55" />
      {/* movement arrows */}
      <path d="M34 55 l-8 5 l8 5" fill="none" stroke={O} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M116 55 l8 5 l-8 5" fill="none" stroke={O} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      {/* obstacle */}
      <rect x="60" y="49" width="30" height="22" rx="4" fill={O} opacity="0.22" />
      <rect x="62" y="51" width="26" height="18" rx="3" fill={O} />
      {/* ball bouncing off the top */}
      <Ball x={104} y={34} r={12} color="#4aa3ff" />
    </Board>
  );
}

/** BREAK — an amber block, cracked, with a ball smashing into it. */
export function BreakArt() {
  const A = '#ffb454';
  return (
    <Board>
      <rect x="60" y="38" width="44" height="40" rx="4" fill={A} opacity="0.2" />
      <rect x="62" y="40" width="40" height="36" rx="3" fill={A} />
      {/* cracks */}
      <path d="M82 40 l-6 12 l8 6 l-5 12" fill="none" stroke="#7a4b12" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M78 58 l-10 -3 M84 52 l9 -2" fill="none" stroke="#7a4b12" strokeWidth="2" strokeLinecap="round" />
      {/* ball hitting from the left + impact spark */}
      <Ball x={38} y={60} r={13} color="#20242b" />
      <path d="M52 60 l7 0 M54 52 l5 3 M54 68 l5 -3" stroke={A} strokeWidth="2.2" strokeLinecap="round" />
    </Board>
  );
}

/** PICKUP — a ball trapped in a pocket that covers a glowing power-up token. */
export function PickupArt() {
  const M = '#e879f9';
  return (
    <Board>
      <rect x="86" y="6" width="58" height="52" fill={ACCENT} opacity="0.18" />
      <path d="M86 58 V6 M86 58 H144" fill="none" stroke={ACCENT} strokeWidth="7" strokeLinecap="round" opacity="0.28" />
      <path d="M86 58 V6 M86 58 H144" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      {/* token */}
      <g transform="translate(122 24)">
        <circle r="13" fill={M} opacity="0.2" />
        <path d="M0 -9 L9 0 L0 9 L-9 0 Z" fill={M} />
        <path d="M0 -4.5 L4.5 0 L0 4.5 L-4.5 0 Z" fill="#ffffff" opacity="0.7" />
      </g>
      {/* ball sealed in over it */}
      <Ball x={106} y={40} r={13} color="#4aa3ff" />
    </Board>
  );
}

/** CIRCUIT — a pulsing teal node wired to a dim sleeping ball. */
export function CircuitArt() {
  const T = '#7fe3d4';
  return (
    <Board>
      {/* link line node -> sleeper */}
      <line x1="52" y1="44" x2="98" y2="74" stroke={T} strokeWidth="1.6" strokeDasharray="5 5" opacity="0.5" />
      {/* terminal node */}
      <circle cx="52" cy="44" r="15" fill="none" stroke={T} strokeWidth="2" opacity="0.5" />
      <circle cx="52" cy="44" r="10" fill="none" stroke={T} strokeWidth="3" />
      <circle cx="52" cy="44" r="3.4" fill={T} />
      {/* sleeping (dormant) ball: dim + caged */}
      <circle cx="98" cy="74" r="15" fill="#ff5a52" opacity="0.28" />
      <circle cx="98" cy="74" r="13" fill="none" stroke={T} strokeWidth="2" opacity="0.7" />
      <circle cx="98" cy="74" r="17" fill="none" stroke={T} strokeWidth="1.4" opacity="0.4" />
    </Board>
  );
}
