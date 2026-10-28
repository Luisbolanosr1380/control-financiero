'use client';

/**
 * TARIFARIO · alta de tarifa. Misma mecánica que el alta de cliente con NIT
 * repetido: si la combinación canónica (NIT + tipo + categoría + territorio)
 * ya existe —aunque esté escrita distinto— se avisa bajo el form y, al
 * guardar, se pide confirmación explícita (sin diálogos del navegador).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearTarifaAction, verificarDuplicadoTarifaAction } from '@/app/(app)/tarifario/actions';
import { CATEGORIAS, TERRITORIOS, TIPOS_PRUEBA, canonCategoria, canonTerritorio, canonTipoPrueba } from '@/lib/tarifario/canon';
import { nitComparable } from '@/lib/clientes/nit';
import type { Tarifa } from '@/lib/tarifario/lookup';

interface Props { onClose: () => void; tarifas: Tarifa[]; inicial?: Partial<{ nit: string; razonSocial: string }> }

const TIPOS_TARIFABLES = TIPOS_PRUEBA.filter(t => t !== 'COMPLETO');

export function TarifaForm({ onClose, tarifas, inicial }: Props) {
  const router = useRouter();
  const [nit, setNit] = useState(inicial?.nit ?? '');
  const [razonSocial, setRazonSocial] = useState(inicial?.razonSocial ?? '');
  const [tipo, setTipo] = useState<string>('POLIGRAFO');
  const [tipoOtro, setTipoOtro] = useState('');
  const [categoria, setCategoria] = useState<string>('PRE EMPLEO');
  const [territorios, setTerritorios] = useState<string[]>(['METROPOLITANA', 'DEPARTAMENTAL']);
  const [monto, setMonto] = useState('');
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [duplicado, setDuplicado] = useState<{ id: string; descripcion: string } | null>(null);
  const [confirmar, setConfirmar] = useState<{ descripcion: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const tipoFinal = tipo === '__otro' ? tipoOtro : tipo;
  const montoNum = Number(String(monto).replace(/,/g, ''));
  const valido = nitComparable(nit).length > 0 && tipoFinal.trim().length > 0 && categoria.trim().length > 0 && territorios.length > 0 && monto.trim() !== '' && Number.isFinite(montoNum) && montoNum >= 0;

  // Razón social: la sugiere el tarifario si el NIT ya tiene tarifas.
  const sugerirRazon = () => {
    const k = nitComparable(nit);
    const t = tarifas.find(x => nitComparable(x.nit) === k);
    if (t && !razonSocial.trim()) setRazonSocial(t.razonSocial);
  };
  const revisarDuplicado = async () => {
    setDuplicado(null); setConfirmar(null);
    if (!nitComparable(nit) || !tipoFinal || !categoria) return;
    try {
      for (const ter of territorios) {
        const d = await verificarDuplicadoTarifaAction({ nit, tipoPrueba: tipoFinal, categoria, territorio: ter });
        if (d) { setDuplicado(d); return; }
      }
    } catch { /* el servidor revalida al guardar */ }
  };
  useEffect(() => { void revisarDuplicado(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipoFinal, categoria, territorios.join('|')]);

  const guardar = async (confirmarDuplicado = false) => {
    if (!valido) return;
    setLoading(true);
    try {
      let creadas = 0;
      for (const ter of territorios) {
        const r = await crearTarifaAction({ nit, razonSocial: razonSocial || undefined, tipoPrueba: tipoFinal, categoria, territorio: ter, monto: montoNum, anio, confirmarDuplicado });
        if (r.ok) { creadas++; continue; }
        if (r.duplicado) { setDuplicado(r.duplicado); setConfirmar({ descripcion: r.duplicado.descripcion }); if (creadas) router.refresh(); return; }
        toast.error(r.error); if (creadas) router.refresh(); return;
      }
      toast.success(creadas === 1 ? `Tarifa creada: ${canonTipoPrueba(tipoFinal)} · ${canonCategoria(categoria)} · Q${montoNum.toFixed(2)}${montoNum === 0 ? ' (sin tarifa definida)' : ''}` : `${creadas} tarifas creadas (${territorios.map(canonTerritorio).join(' y ')}).`);
      onClose(); router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error de red'); }
    finally { setLoading(false); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={() => { if (!loading) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Nueva tarifa" style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', background: 'var(--paper)', borderRadius: 'var(--r-3)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Coins size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Nueva tarifa</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)"><I.X size={15} /></button>
        </div>
        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-nit">NIT del cliente *</label>
              <input id="tf-nit" type="text" className="input num" placeholder="1234567-8" value={nit} onChange={e => { setNit(e.target.value); setDuplicado(null); setConfirmar(null); }} onBlur={() => { sugerirRazon(); void revisarDuplicado(); }} disabled={loading} autoFocus />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-razon">Razón social</label>
              <input id="tf-razon" type="text" className="input" placeholder="Se toma del tarifario o del cliente" value={razonSocial} onChange={e => setRazonSocial(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-tipo">Tipo de prueba *</label>
              <select id="tf-tipo" className="input" value={tipo} onChange={e => setTipo(e.target.value)} disabled={loading}>
                {TIPOS_TARIFABLES.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="__otro">Otro…</option>
              </select>
              {tipo === '__otro' && <input aria-label="Otro tipo de prueba" type="text" className="input" style={{ marginTop: 6 }} placeholder="Nombre del tipo" value={tipoOtro} onChange={e => setTipoOtro(e.target.value)} disabled={loading} />}
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-cat">Categoría *</label>
              <select id="tf-cat" className="input" value={categoria} onChange={e => setCategoria(e.target.value)} disabled={loading}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <span className="label">Territorio * <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(los dos = mismo precio en ambos)</span></span>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
                {TERRITORIOS.map(t => (
                  <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={territorios.includes(t)} onChange={e => setTerritorios(e.target.checked ? [...territorios, t] : territorios.filter(x => x !== t))} disabled={loading} /> {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-monto">Monto sin IVA (Q) *</label>
              <input id="tf-monto" type="text" inputMode="decimal" className="input num" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} disabled={loading} />
              {monto.trim() !== '' && Number.isFinite(montoNum) && montoNum === 0 && <div role="status" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--burnt, #b5651d)' }}>Q0 se guarda como <strong>sin tarifa definida</strong>, no como gratis.</div>}
              {Number.isFinite(montoNum) && montoNum > 0 && <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-4)' }}>Con IVA: Q{(Math.round(montoNum * 112) / 100).toFixed(2)}</div>}
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="tf-anio">Año</label>
              <input id="tf-anio" type="text" inputMode="numeric" className="input num" value={anio} onChange={e => setAnio(e.target.value)} disabled={loading} />
            </div>
          </div>
          {duplicado && !confirmar && (
            <div role="status" style={{ marginTop: 12, fontSize: 11.5, color: 'var(--burnt, #b5651d)', lineHeight: 1.4 }}>
              ⚠ Ya existe una tarifa para esta combinación: {duplicado.descripcion}.
            </div>
          )}
        </div>
        {confirmar ? (
          <div role="alertdialog" aria-label="Confirmar combinación repetida" style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', background: 'var(--paper-2, #f6f1e4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, flex: 1, minWidth: 260 }}>
              <strong>Ya existe una tarifa para esta combinación:</strong> {confirmar.descripcion}. Si la guardás igual, el motor va a avisar la repetición (y si los montos difieren, no podrá resolver el precio). ¿Guardar de todos modos?
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmar(null)} disabled={loading}>Volver</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar(true)} disabled={loading}>{loading ? <><I.Refresh size={13} /> Guardando…</> : 'Guardar de todos modos'}</button>
          </div>
        ) : (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar(false)} disabled={loading || !valido}>{loading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> Guardar tarifa</>}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
