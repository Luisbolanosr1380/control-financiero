'use client';

import { useEffect } from 'react';

/** Registra /sw.js (solo con HTTPS o localhost, que es donde el navegador lo permite). */
export function RegistroSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const seguro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!seguro) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* sin SW la app funciona igual */ });
  }, []);
  return null;
}
