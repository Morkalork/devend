import { useState, useEffect, memo } from 'react';

interface SvgIconProps {
  src: string;
  className?: string;
  alt?: string;
}

// SVG content cache to avoid duplicate fetches
const svgCache: Record<string, string> = {};

// Raw SVG content for icons - imported at build time
const iconSvgs: Record<string, string> = {
  '/icons/slow.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l3 3"/><path d="M7.5 7.5l-1-1M16.5 7.5l1-1"/></svg>`,
  '/icons/shrink.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M4 4l4 4M20 4l-4 4M4 20l4-4M20 20l-4-4"/><path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/></svg>`,
  '/icons/fast.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  '/icons/easy.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
  '/icons/training.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-6"/><path d="M5.5 14V8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6"/><path d="M12 6v5"/></svg>`,
  '/icons/steady.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
  '/icons/snap.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4"/><path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/><path d="M2 12h4M18 12h4"/><path d="M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></svg>`,
  '/icons/bumper.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/></svg>`,
  '/icons/precision.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`,
  '/icons/bonus.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>`,
  '/icons/par.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M12 6v6M9 9h6"/></svg>`,
  '/icons/focus.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
  '/icons/micro.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6" stroke-dasharray="2 2"/><path d="M3 3l4 4M21 3l-4 4M3 21l4-4M21 21l-4-4"/></svg>`,
  '/icons/laser.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L5 7l4 4"/><path d="M5 7h14l-4 4"/><path d="M15 21l4-4-4-4"/><path d="M19 17H5l4-4"/><circle cx="12" cy="12" r="2"/></svg>`,
  '/icons/headstart.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V9h14v7"/><path d="M2 16h20"/><path d="M12 9V5"/><path d="M9 5h6"/><rect x="8" y="16" width="8" height="4" rx="1"/></svg>`,
  '/icons/headstart_plus.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V9h14v7"/><path d="M2 16h20"/><path d="M12 9V5"/><path d="M9 5h6"/><rect x="8" y="16" width="8" height="4" rx="1"/><circle cx="18" cy="6" r="3"/><path d="M18 4.5v3M16.5 6h3"/></svg>`,
  '/icons/net.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 12h16M12 4v16"/><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/></svg>`,
  '/icons/shop.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/><path d="M9 6h6"/></svg>`,
  '/icons/discount.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7.5 16.5L16.5 7.5"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  '/icons/discount_plus.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7.5 16.5L16.5 7.5"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M19 2v4M17 4h4"/></svg>`,
  '/icons/surge.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/><path d="M3 2l3 3M21 2l-3 3M3 22l3-3M21 22l-3-3"/></svg>`,
  '/icons/perfect.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/><path d="M8 12h.01M16 12h.01M12 16h.01"/><circle cx="12" cy="12" r="3"/></svg>`,
  '/icons/time.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/><path d="M2 12h2M20 12h2M12 2v2M12 20v2"/><circle cx="12" cy="12" r="6" stroke-dasharray="2 2"/></svg>`,
  '/icons/divine.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9 9l-7 1 5 5-1.5 7L12 18l6.5 4L17 15l5-5-7-1z"/><circle cx="12" cy="11" r="2"/><path d="M12 6v2M12 14v2"/></svg>`,
  // Super upgrade icons
  '/icons/super/slower-balls.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/><path d="M12 8v2M12 14v2"/><path d="M4 12H2M6 6L4.5 4.5M6 18l-1.5 1.5"/><path d="M18 6l1.5-1.5M18 18l1.5 1.5"/><path d="M20 12h2"/><path d="M8 12h.01M16 12h.01"/></svg>`,
  '/icons/super/faster-fences.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/><path d="M17 2v4M21 2v4M17 18v4M21 18v4"/><path d="M17 6h4M17 18h4"/></svg>`,
  '/icons/super/extra-margin.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/><path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/></svg>`,
  '/icons/super/reduced-area.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3"/><path d="M4 4h3v3M20 4h-3v3M4 20h3v-3M20 20h-3v-3"/></svg>`,
  '/icons/super/score-interest.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><path d="M16 8l-8 8"/><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 3v6h6"/></svg>`,
  '/icons/super/softer-bounces.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/><path d="M8 16c2 1 4 1 8 0"/><path d="M6 18c3 1 6 1 12 0"/></svg>`,
  '/icons/super/thicker-walls.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="3"/><path d="M3 9h18M3 15h18"/><path d="M9 3v18M15 3v18"/></svg>`,
  '/icons/super/longer-preview.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><path d="M17 5l2-2M19 3l2 2"/><circle cx="20" cy="4" r="1" fill="currentColor"/></svg>`,
  '/icons/super/extra-life.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/><path d="M12 8v6M9 11h6"/></svg>`,
  '/icons/super/early-stability.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v4"/><path d="M5 21l7-9 7 9"/><path d="M8 18h8"/><path d="M10 15h4"/></svg>`,
};

export const SvgIcon = memo(function SvgIcon({ src, className = '', alt }: SvgIconProps) {
  const svgContent = iconSvgs[src];

  if (!svgContent) {
    return <div className={className} aria-label={alt} />;
  }

  return (
    <div
      className={className}
      aria-label={alt}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
});
