'use client';

import { PermisosProvider } from '@/components/auth/permisos';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { AIPanel, type ChatMensaje } from '@/components/shell/ai-panel';
import { CommandPalette } from '@/components/shell/command-palette';
import type { Role } from '@/lib/auth/allowlist';
import { AvisoEscritorio } from '@/components/movil/aviso-escritorio';

const CLAVE_VER_IGUAL = 'ver-escritorio-en-telefono';

interface AppShellProps {
  children: React.ReactNode;
  facturasVencidasCount?: number;          // F-043
  deudasVencidasCount?: number;
  pagosPendientesCount?: number;           // F-038.4
  pagosPendientesAlertasRojas?: number;    // F-038.4
  ncsPendientesCount?: number;             // F-045
  rol: Role;
  email: string;
  consumoAuros?: number;
  limiteAuros?: number;
  marcaNombre?: string;
  marcaSub?: string;
  /** MULTI-EMPRESA: el usuario tiene 2+ empresas → ítem "Cambiar de empresa". */
  multiEmpresa?: boolean;
  dueno?: string;
  /** MÓVIL: la app de escritorio no está adaptada al teléfono → aviso en vez de layout roto. */
  esTelefono?: boolean;
}

export function AppShell({ children, facturasVencidasCount, deudasVencidasCount, pagosPendientesCount, pagosPendientesAlertasRojas, ncsPendientesCount, rol, email, consumoAuros, limiteAuros, marcaNombre, marcaSub, multiEmpresa, dueno, esTelefono }: AppShellProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [verIgual, setVerIgual] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(CLAVE_VER_IGUAL) === '1') setVerIgual(true); } catch { /* sin storage */ }
  }, []);
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

  if (esTelefono && !verIgual) {
    return <AvisoEscritorio onAbrirIgual={() => { setVerIgual(true); try { sessionStorage.setItem(CLAVE_VER_IGUAL, '1'); } catch { /* sin storage */ } }} />;
  }

  return (
    <PermisosProvider rol={rol}>
    <div className={'app' + (aiOpen ? ' ai-open' : '')}>
      <Sidebar
        facturasVencidasCount={facturasVencidasCount}
        deudasVencidasCount={deudasVencidasCount}
        pagosPendientesCount={pagosPendientesCount}
        pagosPendientesAlertasRojas={pagosPendientesAlertasRojas}
        ncsPendientesCount={ncsPendientesCount}
        rol={rol}
        email={email}
        marcaNombre={marcaNombre}
        marcaSub={marcaSub}
        multiEmpresa={multiEmpresa}
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
          dueno={dueno}
        />
      )}
      {showCmdK && <CommandPalette onClose={() => setShowCmdK(false)} />}
    </div>
    </PermisosProvider>
  );
}
