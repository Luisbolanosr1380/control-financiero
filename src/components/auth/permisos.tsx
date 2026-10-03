'use client';

/**
 * F-GESTION-USUARIOS — permisos en el cliente (SOLO UX).
 * Oculta/deshabilita lo que el rol no puede hacer. La seguridad real es
 * el guard del servidor (lib/auth/guard.ts), que revalida cada acción.
 */

import { createContext, useContext } from 'react';
import { puede, type Accion, type Rol } from '@/lib/auth/roles';

const RolCtx = createContext<Rol | null>(null);

export function PermisosProvider({ rol, children }: { rol: Rol | null; children: React.ReactNode }) {
  return <RolCtx.Provider value={rol}>{children}</RolCtx.Provider>;
}

export function useRol(): Rol | null {
  return useContext(RolCtx);
}

export function usePuede(): (accion: Accion) => boolean {
  const rol = useContext(RolCtx);
  return (accion: Accion) => puede(rol, accion);
}

/** Renderiza children solo si el rol puede la acción. */
export function SiPuede({ accion, children, fallback = null }: { accion: Accion; children: React.ReactNode; fallback?: React.ReactNode }) {
  const p = usePuede();
  return <>{p(accion) ? children : fallback}</>;
}
