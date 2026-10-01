/**
 * MULTI-EMPRESA · Paso 3 — Selector de empresa.
 *
 * Vive FUERA del grupo (app) a propósito: no monta el AppShell ni el
 * guard de empresa (es la pantalla para elegirla). El middleware de
 * Clerk sí la protege — requiere sesión.
 *
 * Reglas (brief aprobado):
 *  · metadata sin `empresas` (usuarios pre-Paso 4) → directo al
 *    dashboard: decide el allowlist, comportamiento actual de Golden.
 *  · 1 empresa → directo, sin mostrar selector (local o redirect al
 *    deploy externo — la sesión de Clerk es compartida, sin re-login).
 *  · 2+ → tarjetas para elegir; "cambiar de empresa" vuelve acá.
 *  · 0 (metadata presente y vacío) → sin acceso.
 */

import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { empresaConfig } from '@/lib/config/empresa';
import { empresasDeMetadata, resolverSeleccion } from '@/lib/auth/empresas-acceso';

export const dynamic = 'force-dynamic';

export default async function SelectorEmpresasPage() {
  const user = await currentUser();
  const cfg = empresaConfig();
  const empresas = empresasDeMetadata(user?.publicMetadata);
  const seleccion = resolverSeleccion(empresas, cfg.slug);

  if (seleccion.tipo === 'directo-local') redirect('/dashboard');
  if (seleccion.tipo === 'directo-externo') redirect(seleccion.url);

  if (seleccion.tipo === 'sin-empresas') {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div className="card" style={{ maxWidth: 420 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 36 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>Sin empresas asignadas</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              Tu usuario no tiene acceso a ninguna empresa del grupo.
              Pedile al administrador que te asigne una.
            </div>
          </div>
        </div>
      </main>
    );
  }

  // 2+ empresas → tarjetas. La de este deploy entra directo al dashboard;
  // las externas llevan a su propio deploy (sesión Clerk compartida).
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: 'min(560px, 94vw)' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>
            {cfg.nombreSistema}
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>¿Con qué empresa querés trabajar?</h1>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {seleccion.empresas.map(e => {
            const esEsta = e.slug === cfg.slug;
            const contenido = (
              <div className="card" style={{ cursor: 'pointer' }}>
                <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 'var(--r-2)', background: 'var(--olive-bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, color: 'var(--olive)', fontSize: 15,
                  }}>
                    {e.nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{e.nombre}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                      {esEsta ? 'Estás en este entorno' : (e.url ? new URL(e.url).host : e.slug)}
                    </div>
                  </div>
                  <span style={{ color: 'var(--ink-4)' }}>→</span>
                </div>
              </div>
            );
            return esEsta || !e.url
              ? <a key={e.slug} href="/dashboard" style={{ textDecoration: 'none' }}>{contenido}</a>
              : <a key={e.slug} href={e.url} style={{ textDecoration: 'none' }}>{contenido}</a>;
          })}
        </div>
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 11.5, color: 'var(--ink-4)' }}>
          Un solo inicio de sesión para todo el grupo — cada empresa guarda sus finanzas por separado.
        </div>
      </div>
    </main>
  );
}
