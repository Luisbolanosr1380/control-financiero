'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearBancoAction, crearCentroCostoAction, crearCuentaContableAction } from '@/app/(app)/admin/catalogos/actions';
import type { CatalogoResumen } from '@/lib/db/catalogos';

interface Props {
  catalogos: CatalogoResumen;
}

const CARD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 };
const SECCION: React.CSSProperties = {
  fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
};

export function AdminCatalogosClient({ catalogos }: Props) {
  const router = useRouter();

  // ── Banco ──
  const [bNombre, setBNombre]   = useState('');
  const [bBanco, setBBanco]     = useState('');
  const [bNumero, setBNumero]   = useState('');
  const [bMoneda, setBMoneda]   = useState<'GTQ' | 'USD'>('GTQ');
  const [bSaldo, setBSaldo]     = useState('0');
  const [bFecha, setBFecha]     = useState('');
  const [bCuenta, setBCuenta]   = useState('');
  const [bLoading, setBLoading] = useState(false);

  // ── Centro de costo ──
  const [cNombre, setCNombre]         = useState('');
  const [cNaturaleza, setCNaturaleza] = useState('');
  const [cCodigo, setCCodigo]         = useState('');
  const [cObs, setCObs]               = useState('');
  const [cLoading, setCLoading]       = useState(false);

  // ── Cuenta contable ──
  const [qCodigo, setQCodigo]   = useState('');
  const [qNombre, setQNombre]   = useState('');
  const [qDesc, setQDesc]       = useState('');
  const [qLoading, setQLoading] = useState(false);

  const submitBanco = async () => {
    setBLoading(true);
    try {
      const cuentaSel = catalogos.cuentas.find(c => `${c.codigo} · ${c.nombre}` === bCuenta.trim());
      const res = await crearBancoAction({
        nombreCuenta: bNombre.trim(),
        banco: bBanco.trim(),
        numeroCuenta: bNumero.trim() || undefined,
        moneda: bMoneda,
        saldoInicial: parseFloat(bSaldo.replace(/[^\d.-]/g, '')) || 0,
        fechaSaldoInicial: bFecha || undefined,
        cuentaContableId: cuentaSel?.id,
      });
      if (res.ok) { toast.success(res.mensaje); setBNombre(''); setBBanco(''); setBNumero(''); setBSaldo('0'); setBFecha(''); setBCuenta(''); router.refresh(); }
      else toast.error(res.error);
    } finally { setBLoading(false); }
  };

  const submitCentro = async () => {
    setCLoading(true);
    try {
      const res = await crearCentroCostoAction({
        nombre: cNombre.trim(),
        naturaleza: cNaturaleza === 'Recurrente' || cNaturaleza === 'Por proyecto' ? cNaturaleza : undefined,
        codigoCc: cCodigo.trim() || undefined,
        observaciones: cObs.trim() || undefined,
      });
      if (res.ok) { toast.success(res.mensaje); setCNombre(''); setCNaturaleza(''); setCCodigo(''); setCObs(''); router.refresh(); }
      else toast.error(res.error);
    } finally { setCLoading(false); }
  };

  const submitCuenta = async () => {
    setQLoading(true);
    try {
      const res = await crearCuentaContableAction({
        codigoPath: qCodigo.trim(),
        nombre: qNombre.trim(),
        descripcion: qDesc.trim() || undefined,
      });
      if (res.ok) { toast.success(res.mensaje); setQCodigo(''); setQNombre(''); setQDesc(''); router.refresh(); }
      else toast.error(res.error);
    } finally { setQLoading(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogos</h1>
          <div className="page-subtitle" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            Bancos, centros de costo y plan de cuentas — altas que antes se hacían en Airtable.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>

        {/* ── Bancos ── */}
        <div className="card" style={CARD}>
          <div className="card-pad">
            <div style={SECCION}>Cuentas bancarias · {catalogos.bancos.length}</div>
            <div style={{ marginBottom: 14, maxHeight: 150, overflowY: 'auto', fontSize: 12.5 }}>
              {catalogos.bancos.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: b.activo ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                  <span>{b.nombre}{!b.activo && ' (inactiva)'}</span>
                  <span className="num" style={{ color: 'var(--ink-4)' }}>{b.moneda}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Nombre de la cuenta *</label>
                <input className="input" placeholder="BANCO BANRURAL MONETARIA" value={bNombre} onChange={e => setBNombre(e.target.value)} disabled={bLoading} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Banco (institución) *</label>
                <input className="input" placeholder="BANCO DESARROLLO RURAL" value={bBanco} onChange={e => setBBanco(e.target.value)} disabled={bLoading} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">No. de cuenta</label>
                  <input className="input num" value={bNumero} onChange={e => setBNumero(e.target.value)} disabled={bLoading} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Moneda</label>
                  <select className="input" value={bMoneda} onChange={e => setBMoneda(e.target.value === 'USD' ? 'USD' : 'GTQ')} disabled={bLoading}>
                    <option value="GTQ">GTQ</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Saldo inicial (Q)</label>
                  <input className="input num" inputMode="decimal" value={bSaldo} onChange={e => setBSaldo(e.target.value)} disabled={bLoading} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Fecha del saldo</label>
                  <input type="date" className="input num" value={bFecha} onChange={e => setBFecha(e.target.value)} disabled={bLoading} />
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Cuenta contable (plan)</label>
                <input className="input" list="cuentas-banco" placeholder="Buscar por código o nombre…" value={bCuenta} onChange={e => setBCuenta(e.target.value)} disabled={bLoading} />
                <datalist id="cuentas-banco">
                  {catalogos.cuentas.filter(c => c.codigo.startsWith('1-1-1')).map(c => (
                    <option key={c.id} value={`${c.codigo} · ${c.nombre}`} />
                  ))}
                </datalist>
              </div>
              <button className="btn btn-primary" onClick={submitBanco} disabled={bLoading || !bNombre.trim() || !bBanco.trim()}>
                {bLoading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Plus size={13} /> Crear cuenta bancaria</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Centros de costo ── */}
        <div className="card" style={CARD}>
          <div className="card-pad">
            <div style={SECCION}>Centros de costo · {catalogos.centros.length}</div>
            <div style={{ marginBottom: 14, maxHeight: 150, overflowY: 'auto', fontSize: 12.5 }}>
              {catalogos.centros.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: c.activo ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                  <span>{c.nombre}{!c.activo && ' (inactivo)'}</span>
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>{c.naturaleza || '—'}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Nombre *</label>
                <input className="input" placeholder="Insight360" value={cNombre} onChange={e => setCNombre(e.target.value)} disabled={cLoading} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Naturaleza (clasifica la retención de clientes)</label>
                <select className="input" value={cNaturaleza} onChange={e => setCNaturaleza(e.target.value)} disabled={cLoading}>
                  <option value="">— Sin definir —</option>
                  <option value="Recurrente">Recurrente (mes a mes)</option>
                  <option value="Por proyecto">Por proyecto (episódico)</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Código CC</label>
                <input className="input num" value={cCodigo} onChange={e => setCCodigo(e.target.value)} disabled={cLoading} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Observaciones</label>
                <textarea className="input" rows={2} value={cObs} onChange={e => setCObs(e.target.value)} disabled={cLoading} />
              </div>
              <button className="btn btn-primary" onClick={submitCentro} disabled={cLoading || !cNombre.trim()}>
                {cLoading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Plus size={13} /> Crear centro de costo</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Cuentas contables ── */}
        <div className="card" style={CARD}>
          <div className="card-pad">
            <div style={SECCION}>Plan de cuentas · {catalogos.cuentas.length}</div>
            <div style={{ marginBottom: 14, maxHeight: 150, overflowY: 'auto', fontSize: 12 }}>
              {catalogos.cuentas.filter(c => c.nivel <= 2).map(c => (
                <div key={c.id} style={{ padding: '2px 0', color: 'var(--ink-2)', paddingLeft: (c.nivel - 1) * 14 }}>
                  <span className="num" style={{ color: 'var(--ink-4)', marginRight: 6 }}>{c.codigo}</span>{c.nombre}
                </div>
              ))}
              <div style={{ color: 'var(--ink-4)', paddingTop: 4, fontSize: 11.5 }}>… niveles 3-5 ocultos ({catalogos.cuentas.length} en total)</div>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Código jerárquico * (el padre debe existir)</label>
                <input className="input num" placeholder="1-1-1-5" value={qCodigo} onChange={e => setQCodigo(e.target.value)} disabled={qLoading} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Nombre *</label>
                <input className="input" placeholder="Banco Nuevo Monetaria" value={qNombre} onChange={e => setQNombre(e.target.value)} disabled={qLoading} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Descripción</label>
                <textarea className="input" rows={2} value={qDesc} onChange={e => setQDesc(e.target.value)} disabled={qLoading} />
              </div>
              <button className="btn btn-primary" onClick={submitCuenta} disabled={qLoading || !qCodigo.trim() || !qNombre.trim()}>
                {qLoading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Plus size={13} /> Crear cuenta contable</>}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
