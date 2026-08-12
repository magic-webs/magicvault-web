'use client';

import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('Service Worker registered successfully with scope:', reg.scope);
          })
          .catch((err) => {
            console.error('Service Worker registration failed:', err);
          });
      });
    }
  }, []);

  return null;
}
