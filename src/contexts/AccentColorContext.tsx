import { createContext, useContext, ReactNode, useEffect } from 'react';
import { useColorProgression } from '@/hooks/useColorProgression';

interface AccentColorContextValue {
  accentHex: string;
  colorName: string;
  getAccentColor: (alpha?: number) => string;
}

const AccentColorContext = createContext<AccentColorContextValue>({
  accentHex: '#00ff88',
  colorName: 'Neon Green',
  getAccentColor: () => '#00ff88',
});

interface AccentColorProviderProps {
  children: ReactNode;
  currentLevel: number;
}

export function AccentColorProvider({ children, currentLevel }: AccentColorProviderProps) {
  const { accentHex, currentColor, getAccentColor } = useColorProgression(currentLevel);

  // Update CSS custom properties when color changes
  useEffect(() => {
    const root = document.documentElement;
    const hex = currentColor.hex;
    
    // Parse hex to HSL for CSS variables
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    const hslValue = `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    
    // Update all relevant CSS variables
    root.style.setProperty('--primary', hslValue);
    root.style.setProperty('--accent', hslValue);
    root.style.setProperty('--ring', hslValue);
    root.style.setProperty('--ball', hslValue);
    root.style.setProperty('--ball-glow', hslValue);
    root.style.setProperty('--wall-active', hslValue);
    root.style.setProperty('--success', hslValue);
    
    // Update glow effects
    root.style.setProperty('--glow-primary', `0 0 30px hsl(${hslValue} / 0.5)`);
    root.style.setProperty('--glow-accent', `0 0 30px hsl(${hslValue} / 0.6)`);
    root.style.setProperty('--glow-success', `0 0 30px hsl(${hslValue} / 0.5)`);
  }, [currentColor.hex]);

  return (
    <AccentColorContext.Provider value={{ 
      accentHex, 
      colorName: currentColor.name, 
      getAccentColor 
    }}>
      {children}
    </AccentColorContext.Provider>
  );
}

export function useAccentColor() {
  return useContext(AccentColorContext);
}
