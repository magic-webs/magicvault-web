'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ThemeMode = 'dark' | 'light';

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  toggleTheme: () => {},
  setMode: () => {},
});

const STORAGE_KEY = 'magic-vault-theme-mode';

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initialMode = saved === 'light' || saved === 'dark' ? saved : 'dark';
    setModeState(initialMode);
    
    // Apply theme class to documentElement
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(initialMode);
  }, []);

  function setMode(newMode: ThemeMode) {
    setModeState(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newMode);
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(newMode);
    }
  }

  function toggleTheme() {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle({ className }: { className?: string }) {
  const { mode, toggleTheme } = useAppTheme();
  const isDark = mode === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggleTheme}
      title={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
      aria-label={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
