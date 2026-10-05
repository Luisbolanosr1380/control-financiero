'use client';

/**
 * "Instalar app": en Android/Chrome usa el aviso nativo (beforeinstallprompt);
 * en iPhone/iPad no existe ese evento, así que se explica el paso manual
 * (Compartir → Agregar a inicio). No se muestra si ya corre instalada o si
 * el usuario lo cerró.
 */
import { useEffect, useState } from 'react';
import s from './movil.module.css';

interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const CLAVE = 'pwa-instalar-cerrado';

export function BannerInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [ios, setIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const instalada = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    let cerrado = false;
    try { cerrado = localStorage.getItem(CLAVE) === '1'; } catch { /* sin storage: se muestra */ }
    if (instalada || cerrado) return;
    const esIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIos(esIos);
    if (esIos) setVisible(true);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); setVisible(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!visible) return null;
  const cerrar = () => { setVisible(false); try { localStorage.setItem(CLAVE, '1'); } catch { /* nada */ } };

  return (
    <div className={s.instalar} role="note">
      {ios
        ? <span>Instalá la app: tocá <strong>Compartir</strong> y después <strong>Agregar a inicio</strong>.</span>
        : <span>Instalá la app en tu teléfono para abrirla con un toque.</span>}
      {evento && (
        <button type="button" onClick={async () => { await evento.prompt(); await evento.userChoice; cerrar(); }}>Instalar</button>
      )}
      <button type="button" onClick={cerrar} aria-label="Cerrar" style={{ background: 'transparent', color: 'var(--ink-3)', marginLeft: evento ? 0 : 'auto' }}>✕</button>
    </div>
  );
}
