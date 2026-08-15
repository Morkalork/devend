/// <reference types="vite/client" />

// Injected by vite.config.ts at build time (see buildIdentity). Declared, not
// imported, because Vite replaces these textually before TypeScript sees them.
// They are absent under vitest, so every read goes through src/lib/buildInfo.ts
// rather than touching them directly.
declare const __BUILD_SHA__: string;
declare const __BUILD_AT__: string;
declare const __BUILD_REPO__: string;
