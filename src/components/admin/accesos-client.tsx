'use client';

/**
 * F-GESTION-USUARIOS — "Usuarios y accesos" (solo admin).
 * Una columna por empresa con el rol del usuario en ella. Solo se pueden
 * tocar las empresas donde quien edita es admin (el servidor lo revalida).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import {
  ROLES, ROL_LABEL, ROL_DESCRIPCION, MATRIZ, ACCION_LABEL,
  type Acceso, type Accion, type Rol,
} from '@/lib/auth/roles';
import type { DeployEmpresa } from '@/lib/config/deploys';
import type { UsuarioAccesos } from '@/lib/auth/usuarios-clerk';
import {
  actualizarAccesosAction, bloquearUsuarioAction, invitarUsuarioAction, revocarInvitacionAction,
} from '@/app/(app)/admin/usuarios/actions';

interface Props {
  usuarios: UsuarioAccesos[];
  empresas: DeployEmpresa[];
  slugActual: string;
  miUserId: string;
  misAccesos: Acceso[];
  errorClerk: string | null;
}

type Mapa = Record<string, Rol | ''>;   // slug → rol ('' = sin acceso)

const ROL_CLS: Record<Rol, string> = {
  admin: 'badge-wine', contador: 'badge-olive', auxiliar: 'badge-outline', lectura: 'badge-mute',
};

const aMapa = (accesos: Acceso[]): Mapa => Object.fromEntries(accesos.map(a => [a.empresa_slug, a.rol]));
const aAccesos = (m: Mapa): Acceso[] =>
  Object.entries(m).filter(([, r]) => r).map(([empresa_slug, rol]) => ({ empresa_slug, rol: rol as Rol }));

const ACCIONES_MATRIZ: Accion[] = [
  'ver', 'emitir_factura', 'registrar_cobro', 'registrar_gasto', 'aprobar_gasto', 'pagar', 'anular',
  'planilla', 'cerrar_periodo', 'catalogos', 'gestionar_deudas', 'gestionar_usuarios', 'configurar_empresa',
];

export function AccesosClient({ usuarios, empresas, slugActual, miUserId, misAccesos, errorClerk }: Props) {
  const router = useRouter();
  const adminDe = useMemo(() => new Set(misAccesos.filter(a => a.rol === 'admin').map(a => a.empresa_slug)), [misAccesos]);
  const [borradores, setBorradores] = useState<Record<string, Mapa>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [verMatriz, setVerMatriz] = useState(false);
  const [mostrarSinAcceso, setMostrarSinAcceso] = useState(false);

  // Invitar
  const [invEmail, setInvEmail] = useState('');
  const [invNombre, setInvNombre] = useState('');
  const [invMapa, setInvMapa] = useState<Mapa>({ [slugActual]: 'auxiliar' });

  const conAcceso = usuarios.filter(u => u.accesos.length > 0 || u.tipo === 'invitacion');
  const sinAcceso = usuarios.filter(u => u.accesos.length === 0 && u.tipo === 'usuario');

  const mapaDe = (u: UsuarioAccesos): Mapa => borradores[u.id] ?? aMapa(u.accesos);
  const cambiado = (u: UsuarioAccesos) => {
    const b = borradores[u.id];
    if (!b) return false;
    const orig = aMapa(u.accesos);
    const slugs = new Set([...Object.keys(orig), ...Object.keys(b)]);
    return [...slugs].some(s => (orig[s] ?? '') !== (b[s] ?? ''));
  };

  const correr = async (key: string, fn: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) { toast.success(r.mensaje); router.refresh(); return true; }
      toast.error(r.error);
      return false;
    } finally { setBusy(null); }
  };

  const guardar = (u: UsuarioAccesos) => correr(u.id, () => actualizarAccesosAction(u.id, aAccesos(mapaDe(u)))).then(ok => {
    if (ok) setBorradores(prev => { const n = { ...prev }; delete n[u.id]; return n; });
  });

  const invitar = () => correr('invitar', () => invitarUsuarioAction({ email: invEmail, nombre: invNombre, accesos: aAccesos(invMapa) })).then(ok => {
    if (ok) { setInvEmail(''); setInvNombre(''); setInvMapa({ [slugActual]: 'auxiliar' }); }
  });

  const SelectorRol = ({ value, onChange, disabled, title }: { value: Rol | ''; onChange: (r: Rol | '') => void; disabled?: boolean; title?: string }) => (
    <select className="input" value={value} disabled={disabled} title={title}
      onChange={e => onChange(e.target.value as Rol | '')}
      style={{ fontSize: 12, padding: '4px 6px', minWidth: 118, opacity: disabled ? 0.65 : 1 }}>
      <option value="">— Sin acceso —</option>
      {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
    </select>
  );

  const fila = (u: UsuarioAccesos) => {
    const m = mapaDe(u);
    const esYo = u.id === miUserId;
    const esInv = u.tipo === 'invitacion';
    return (
      <tr key={u.id} style={{ opacity: u.bloqueado ? 0.55 : 1 }}>
        <td>
          <div className="cell-strong" style={{ fontSize: 13 }}>
            {u.nombre || u.email}
            {esYo && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>(vos)</span>}
          </div>
          {u.nombre && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{u.email}</div>}
          <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            {esInv && <span className="badge badge-warn" style={{ fontSize: 10 }}>Invitación pendiente</span>}
            {u.bloqueado && <span className="badge badge-wine" style={{ fontSize: 10 }}>Bloqueado</span>}
            {u.legacy && <span className="badge badge-mute" style={{ fontSize: 10 }} title="Sin accesos explícitos: rol derivado del allowlist anterior. Guardá para fijarlo.">Esquema anterior</span>}
          </div>
        </td>
        {empresas.map(e => {
          const puedeEditar = adminDe.has(e.slug) && !esInv && !u.bloqueado;
          return (
            <td key={e.slug}>
              {esInv ? (
                m[e.slug] ? <span className={'badge ' + ROL_CLS[m[e.slug] as Rol]}>{ROL_LABEL[m[e.slug] as Rol]}</span> : <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>—</span>
              ) : (
                <SelectorRol
                  value={m[e.slug] ?? ''}
                  disabled={!puedeEditar || busy === u.id}
                  title={puedeEditar ? undefined : `Solo un admin de ${e.nombre} puede cambiar este acceso`}
                  onChange={r => setBorradores(prev => ({ ...prev, [u.id]: { ...mapaDe(u), [e.slug]: r } }))}
                />
              )}
            </td>
          );
        })}
        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
          {esInv ? (
            <button className="btn btn-ghost" style={{ fontSize: 11.5, color: 'var(--wine)' }} disabled={busy === u.id}
              onClick={() => window.confirm(`¿Revocar la invitación a ${u.email}?`) && correr(u.id, () => revocarInvitacionAction(u.id))}>
              Revocar
            </button>
          ) : (
            <>
              {cambiado(u) && (
                <>
                  <button className="btn btn-primary" style={{ fontSize: 11.5, padding: '4px 10px' }} disabled={busy === u.id} onClick={() => guardar(u)}>
                    {busy === u.id ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy === u.id}
                    onClick={() => setBorradores(prev => { const n = { ...prev }; delete n[u.id]; return n; })}>
                    Descartar
                  </button>
                </>
              )}
              {u.legacy && !cambiado(u) && (
                <button className="btn btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} disabled={busy === u.id}
                  title="Fija estos accesos en su perfil (deja de depender del allowlist)" onClick={() => guardar(u)}>
                  Fijar accesos
                </button>
              )}
              {!esYo && (
                <button className="btn btn-ghost" style={{ fontSize: 11.5, color: u.bloqueado ? 'var(--olive)' : 'var(--wine)' }} disabled={busy === u.id}
                  onClick={() => window.confirm(u.bloqueado
                    ? `¿Desbloquear a ${u.email}?`
                    : `¿Bloquear a ${u.email}? No podrá iniciar sesión en NINGUNA empresa. Para quitarle solo esta empresa, poné "Sin acceso".`)
                    && correr(u.id, () => bloquearUsuarioAction(u.id, !u.bloqueado))}>
                  {u.bloqueado ? 'Desbloquear' : 'Bloquear'}
                </button>
              )}
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuarios y accesos</h1>
          <div className="page-subtitle">
            Quién entra a cada empresa y con qué rol. Aprobar gastos y hacer pagos es solo de Admin y Contador.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setVerMatriz(v => !v)}>
            <I.Info size={13} /> {verMatriz ? 'Ocultar' : 'Ver'} qué puede cada rol
          </button>
        </div>
      </div>

      {errorClerk && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--wine)' }}>
          <div className="card-pad" style={{ fontSize: 12.5, color: 'var(--wine)' }}>No se pudo leer Clerk: {errorClerk}</div>
        </div>
      )}

      {verMatriz && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><div className="card-title">Roles y permisos</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid var(--line-3)' }}>
            {ROLES.map(r => (
              <div key={r} style={{ padding: '12px 16px', borderRight: '1px solid var(--line-3)' }}>
                <span className={'badge ' + ROL_CLS[r]}>{ROL_LABEL[r]}</span>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>{ROL_DESCRIPCION[r]}</div>
              </div>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr><th>Acción</th>{ROLES.map(r => <th key={r} style={{ width: 110, textAlign: 'center' }}>{ROL_LABEL[r]}</th>)}</tr>
            </thead>
            <tbody>
              {ACCIONES_MATRIZ.map(a => (
                <tr key={a}>
                  <td style={{ fontSize: 12.5 }}>{ACCION_LABEL[a].charAt(0).toUpperCase() + ACCION_LABEL[a].slice(1)}</td>
                  {ROLES.map(r => (
                    <td key={r} style={{ textAlign: 'center', color: MATRIZ[a].includes(r) ? 'var(--olive)' : 'var(--ink-4)' }}>
                      {MATRIZ[a].includes(r) ? '✓' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invitar */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><div className="card-title">Invitar usuario</div></div>
        <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: `1.4fr 1fr ${empresas.map(() => '150px').join(' ')} auto`, gap: 10, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Email *</label>
            <input className="input" type="email" placeholder="persona@empresa.com" value={invEmail} onChange={e => setInvEmail(e.target.value)} disabled={busy === 'invitar'} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Nombre</label>
            <input className="input" value={invNombre} onChange={e => setInvNombre(e.target.value)} disabled={busy === 'invitar'} />
          </div>
          {empresas.map(e => (
            <div key={e.slug} className="field" style={{ margin: 0 }}>
              <label className="label" title={adminDe.has(e.slug) ? undefined : `No sos admin de ${e.nombre}`}>{e.nombre}</label>
              <SelectorRol value={invMapa[e.slug] ?? ''} disabled={!adminDe.has(e.slug) || busy === 'invitar'}
                onChange={r => setInvMapa(prev => ({ ...prev, [e.slug]: r }))} />
            </div>
          ))}
          <button className="btn btn-primary" onClick={invitar} disabled={busy === 'invitar' || !invEmail.trim() || aAccesos(invMapa).length === 0}>
            {busy === 'invitar' ? 'Enviando…' : <><I.Plus size={13} /> Invitar</>}
          </button>
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 11.5, color: 'var(--ink-4)' }}>
          Le llega un email de invitación; al crear su cuenta entra directo con estos accesos. Solo podés asignar empresas donde sos admin.
        </div>
      </div>

      {/* Lista */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Usuarios</div>
          <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            {conAcceso.filter(u => u.tipo === 'usuario').length} con acceso · {conAcceso.filter(u => u.tipo === 'invitacion').length} invitación(es)
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Usuario</th>
              {empresas.map(e => <th key={e.slug} style={{ width: 150 }}>{e.nombre}{e.slug === slugActual && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--ink-4)' }}>(esta)</span>}</th>)}
              <th style={{ width: 210 }}></th>
            </tr>
          </thead>
          <tbody>
            {conAcceso.length === 0
              ? <tr><td colSpan={empresas.length + 2} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Sin usuarios con acceso.</td></tr>
              : conAcceso.map(fila)}
          </tbody>
        </table>
        {sinAcceso.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line-3)' }}>
            <button className="btn btn-ghost" style={{ margin: '8px 12px', fontSize: 12 }} onClick={() => setMostrarSinAcceso(v => !v)}>
              {mostrarSinAcceso ? 'Ocultar' : 'Ver'} {sinAcceso.length} cuenta(s) sin acceso a ninguna empresa
            </button>
            {mostrarSinAcceso && (
              <table className="table"><tbody>{sinAcceso.map(fila)}</tbody></table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
