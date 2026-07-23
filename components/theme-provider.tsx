'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

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
    if (saved === 'light' || saved === 'dark') {
      setModeState(saved);
    }
  }, []);

  function setMode(newMode: ThemeMode) {
    setModeState(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newMode);
    }
  }

  function toggleTheme() {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme, setMode }}>
      <Theme theme={neutralTheme} mode={mounted ? mode : 'dark'}>
        {children}
      </Theme>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { mode, toggleTheme } = useAppTheme();
  const isDark = mode === 'dark';

  return (
    <IconButton
      label={isDark ? 'Switch to Light mode' : 'Switch to Dark mode'}
      icon={<Icon icon={isDark ? SunIcon : MoonIcon} />}
      variant="ghost"
      size={size}
      onClick={toggleTheme}
    />
  );
}
