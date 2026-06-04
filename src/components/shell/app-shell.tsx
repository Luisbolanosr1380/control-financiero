'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { AIPanel, type ChatMensaje } from '@/components/shell/ai-panel';
import { CommandPalette } from '@/components/shell/command-palette';
import type { Role } from '@/lib/auth/allowlist';

interface AppShellProps {
  children: React.ReactNode;
  deudasVencidasCount?: number;
  pagosPendientesCount?: number;           // F-038.4
  pagosPendientesAlertasRojas?: number;    // F-038.4
  rol: Role;
  email: string;
  consumoAuros?: number;
  limiteAuros?: number;
}

export function AppShell({ children, deudasVencidasCount, pagosPendientesCount, pagosPendientesAlertasRojas, rol, email, consumoAuros, limiteAuros }: AppShellProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [showCmdK, setShowCmdK] = useState(false);

  // El historial vive aquí — sobrevive al cierre/apertura del drawer y a
  // las navegaciones entre pantallas. Se pierde solo al recargar la página.
  const [chatMensajes, setChatMensajes] = useState<ChatMensaje[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCmdK((open) => !open);
      } else if (e.key === 'Escape') {
        setShowCmdK(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={'app' + (aiOpen ? ' ai-open' : '')}>
      <Sidebar
        deudasVencidasCount={deudasVencidasCount}
        pagosPendientesCount={pagosPendientesCount}
        pagosPendientesAlertasRojas={pagosPendientesAlertasRojas}
        rol={rol}
        email={email}
      />

      <div className="main">
        <Topbar aiOpen={aiOpen} setAiOpen={setAiOpen} onSearch={() => setShowCmdK(true)} />
        {children}
      </div>

      {aiOpen && (
        <AIPanel
          onClose={() => setAiOpen(false)}
          mensajes={chatMensajes}
          setMensajes={setChatMensajes}
          rol={rol}
          consumoMensual={consumoAuros ?? 0}
          limiteMensual={limiteAuros ?? 0}
        />
      )}
      {showCmdK && <CommandPalette onClose={() => setShowCmdK(false)} />}
    </div>
  );
}
