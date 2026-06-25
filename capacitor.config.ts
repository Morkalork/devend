import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.morkalork.devend',
  appName: 'Dev/End',
  // Vite builds to dist/; Capacitor copies this into the native project on `cap sync`.
  webDir: 'dist',
  android: {
    // Capacitor serves the bundled assets from http://localhost so absolute
    // paths (/map.yml, BrowserRouter history) resolve correctly in the WebView.
    backgroundColor: '#0a0f0a',
  },
  plugins: {
    SplashScreen: {
      // Shows @drawable/splash full-screen; Android picks the portrait/landscape
      // variant automatically. The drawables hold assets/banner_*.png.
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#0a0f0a',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
      showSpinner: false,
    },
  },
};

export default config;
