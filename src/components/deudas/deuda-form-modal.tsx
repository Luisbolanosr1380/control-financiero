'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import {
  crearDeudaAction,
  editarDeudaAction,
  crearAcreedorAction,
} from '@/app/(app)/deudas/actions';
import {
  TIPOS_ACREEDOR,
  TIPOS_PRODUCTO_ACREEDOR,
  type TipoAcreedor,
} from '@/lib/db/acreedores';
import { TIPOS_DOCUMENTO, type TipoDocumento, type Deuda } from '@/lib/db/deudas';
import type { Acreedor } from '@/lib/db/deudas';

interface Props {
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
  modo: 'crear' | 'editar';
  deudaActual?: Deuda;          // requerido si modo='editar'
  numPagos?: number;             // si > 0 deshabilita cambio de tipoDocumento
  onClose: () => void;
}

// Tipos de documento que requieren cada bloque de campos. Mapeo de UI.
const CONTEXT_TARJETA: TipoDocumento[] = ['Tarjeta', 'Estado de Cuenta'];
const CONTEXT_PRESTAMO: TipoDocumento[] = ['Préstamo', 'Contrato/Pagaré', 'Leasing'];
const CONTEXT_FACTORAJE: TipoDocumento[] = ['Factoraje'];
const CONTEXT_FACTURA: TipoDocumento[] = ['Factura', 'Nota Débito', 'Nota de Crédito'];
const CONTEXT_PERIODICO: TipoDocumento[] = ['Obligación Seguridad Social', 'Devengo de Nómina', 'Provisión'];

export function DeudaFormModal({ acreedores, centros, modo, deudaActual, numPagos = 0, onClose }: Props) {
  const router = useRouter();
  const today = obtenerFechaHoyGuatemala();

  // ─────────────────────────────────────────────────────────
  // Sub-modal "Crear acreedor"
  // ─────────────────────────────────────────────────────────
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [acreedoresLista, setAcreedoresLista] = useState<Acreedor[]>(acreedores);

  // ─────────────────────────────────────────────────────────
  // Estado del form de deuda
  // ─────────────────────────────────────────────────────────
  const [acreedorId, setAcreedorId] = useState(deudaActual?.acreedorId ?? '');
  const [acreedorSearch, setAcreedorSearch] = useState('');
  const [showAcreedorList, setShowAcreedorList] = useState(false);
  const [tipoDoc, setTipoDoc] = useState<TipoDocumento>(deudaActual?.tipoDocumento as TipoDocumento || 'Préstamo');
  const [centroId, setCentroId] = useState(deudaActual?.centroCostoId ?? '');
  const [fechaEmision, setFechaEmision] = useState(deudaActual?.fechaEmision?.slice(0, 10) || today);
  const [moneda, setMoneda] = useState<'Q' | 'USD'>(deudaActual?.moneda === 'USD' ? 'USD' : 'Q');
  const [tipoCambio, setTipoCambio] = useState('1');
  const [montoOriginal, setMontoOriginal] = useState(deudaActual ? String(deudaActual.montoOriginal) : '');
  const [nombreDeuda, setNombreDeuda] = useState(deudaActual?.nombreDeuda ?? '');
  const [notas, setNotas] = useState(deudaActual?.notas ?? '');

  // Campos específicos (sin pre-cargar para editar — Airtable no expone todos)
  const [limite, setLimite] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [tasaInteresAnual, setTasaInteresAnual] = useState(deudaActual?.tasaInteres ? String(deudaActual.tasaInteres * 100) : '');
  const [diaPagoFijo, setDiaPagoFijo] = useState('');
  const [plazoMeses, setPlazoMeses] = useState('');
  const [fechaPrimerCuota, setFechaPrimerCuota] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState(deudaActual?.fechaVencimiento?.slice(0, 10) || '');
  const [tasaComision, setTasaComision] = useState('');
  const [ivaComision, setIvaComision] = useState('');
  const [reserva, setReserva] = useState('');
  const [plazoDias, setPlazoDias] = useState('');
  const [conRecurso, setConRecurso] = useState(false);
  const [numeroFactura, setNumeroFactura] = useState('');
  const [plazoCreditoDias, setPlazoCreditoDias] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enviando]);

  const acreedorSeleccionado = acreedoresLista.find(a => a.id === acreedorId);

  // Validaciones
  const errores: string[] = [];
  if (!acreedorId)              errores.push('Acreedor requerido.');
  if (!tipoDoc)                 errores.push('Tipo de documento requerido.');
  if (!fechaEmision)            errores.push('Fecha de emisión requerida.');
  if (fechaEmision > today)     errores.push('Fecha de emisión no puede ser futura.');
  const monto = parseFloat(montoOriginal);
  if (!(monto > 0))             errores.push('Monto original debe ser mayor a 0.');
  if (fechaVencimiento && fechaVencimiento < fechaEmision) errores.push('La fecha de vencimiento no puede ser anterior a la emisión.');
  if (ultimos4 && (ultimos4.length !== 4 || !/^\d{4}$/.test(ultimos4))) errores.push('Últimos 4 deben ser exactamente 4 dígitos.');
  const dpf = parseInt(diaPagoFijo, 10);
  if (diaPagoFijo && (isNaN(dpf) || dpf < 1 || dpf > 31)) errores.push('Día de pago fijo debe ser 1–31.');

  const cambioTipoBloqueado = modo === 'editar' && numPagos > 0 && deudaActual && tipoDoc !== deudaActual.tipoDocumento;
  if (cambioTipoBloqueado) errores.push(`No se puede cambiar el tipo: la deuda tiene ${numPagos} pago(s).`);

  const puedeEnviar = errores.length === 0 && !enviando;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setEnviando(true);
    try {
      const tasaInteresDecimal = tasaInteresAnual ? parseFloat(tasaInteresAnual) / 100 : undefined;
      const baseInput = {
        acreedorId,
        nombreDeuda: nombreDeuda.trim() || undefined,
        tipoDocumento: tipoDoc,
        centroCostoId: centroId || undefined,
        fechaEmision,
        moneda,
        tipoCambio: parseFloat(tipoCambio) || 1,
        montoOriginal: monto,
        notas: notas.trim() || undefined,
        plazoMeses: parseInt(plazoMeses) || undefined,
        fechaPrimerCuota: fechaPrimerCuota || undefined,
        fechaVencimiento: fechaVencimiento || undefined,
        tasaInteresAnual: tasaInteresDecimal,
        diaPagoFijo: dpf || undefined,
        ultimos4Tarjeta: ultimos4 || undefined,
        limite: parseFloat(limite) || undefined,
        tasaComision: tasaComision ? parseFloat(tasaComision) / 100 : undefined,
        ivaComision: ivaComision ? parseFloat(ivaComision) / 100 : undefined,
        reserva: reserva ? parseFloat(reserva) / 100 : undefined,
        plazoDias: parseInt(plazoDias) || undefined,
        plazoCreditoDias: parseInt(plazoCreditoDias) || undefined,
        conRecurso,
        numeroFactura: numeroFactura.trim() || undefined,
      };

      if (modo === 'crear') {
        const res = await crearDeudaAction(baseInput);
        if (res.ok) {
          toast.success(res.mensaje);
          onClose();
          router.push(`/deudas/${res.deudaId}`);
        } else {
          toast.error(res.error);
        }
      } else {
        if (!deudaActual) throw new Error('deudaActual requerida para editar');
        const res = await editarDeudaAction(deudaActual.id, baseInput);
        if (res.ok) {
          toast.success(res.mensaje);
          onClose();
          router.refresh();
        } else {
          toast.error(res.error);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  };

  const handleAcreedorCreado = (nuevo: Acreedor) => {
    setAcreedoresLista(prev => [nuevo, ...prev]);
    setAcreedorId(nuevo.id);
    setAcreedorSearch('');
    setShowAcreedorList(false);
  };

  if (!mounted) return null;

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(acreedorSearch);
  const acreedoresFiltrados = acreedorSearch
    ? acreedoresLista.filter(a => norm(a.nombre).includes(q) || norm(a.nombreLegal).includes(q)).slice(0, 8)
    : acreedoresLista.slice(0, 12);

  const showTarjeta   = CONTEXT_TARJETA.includes(tipoDoc);
  const showPrestamo  = CONTEXT_PRESTAMO.includes(tipoDoc);
  const showFactoraje = CONTEXT_FACTORAJE.includes(tipoDoc);
  const showFactura   = CONTEXT_FACTURA.includes(tipoDoc);
  const showPeriodico = CONTEXT_PERIODICO.includes(tipoDoc);

  const body = (
    <div
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14, 42, 36, 0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000,
        padding: 20, paddingTop: 40, overflowY: 'auto',
      }}
    >
      <div className="card" style={{
        width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--paper-2)', padding: 0,
      }}>
        <div className="card-head" style={{ borderBottom: '1px solid var(--line-3)', position: 'sticky', top: 0, background: 'var(--paper-2)', zIndex: 1 }}>
          <div>
            <div className="card-title">
              {modo === 'crear' ? 'Nueva deuda' : `Editar deuda${deudaActual?.nombreDeuda ? ` · ${deudaActual.nombreDeuda}` : ''}`}
            </div>
            {modo === 'editar' && numPagos > 0 && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                Esta deuda tiene <strong>{numPagos} pago(s)</strong> registrado(s) — el tipo de documento queda bloqueado.
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose} disabled={enviando}><I.X size={14} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          {/* DATOS GENERALES */}
          <section>
            <h3 style={sectionTitle}>Datos generales</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>

              {/* Acreedor — combobox con búsqueda + opción "+ Crear nuevo" */}
              <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
                <Field label="Acreedor">
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Buscar o seleccionar acreedor..."
                      value={acreedorSearch || acreedorSeleccionado?.nombre || ''}
                      onChange={(e) => { setAcreedorSearch(e.target.value); setShowAcreedorList(true); setAcreedorId(''); }}
                      onFocus={() => setShowAcreedorList(true)}
                      style={inputStyle}
                    />
                    {showAcreedorList && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                        background: 'var(--paper-2)', border: '1px solid var(--line-2)', borderRadius: 6,
                        maxHeight: 240, overflowY: 'auto', zIndex: 10,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                      }}>
                        <button
                          type="button"
                          onClick={() => { setSubModalOpen(true); setShowAcreedorList(false); }}
                          style={comboItemNuevo}
                        >
                          <I.Plus size={12} /> Crear acreedor nuevo
                        </button>
                        {acreedoresFiltrados.length === 0 ? (
                          <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ink-4)' }}>Sin coincidencias</div>
                        ) : acreedoresFiltrados.map(a => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => { setAcreedorId(a.id); setAcreedorSearch(''); setShowAcreedorList(false); }}
                            style={comboItem}
                          >
                            <div style={{ fontSize: 12.5 }}>{a.nombre || a.nombreLegal}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{a.tipoAcreedor || '—'}{a.esParteRelacionada ? ' · Parte relacionada' : ''}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              </div>

              <Field label="Tipo de documento">
                <select
                  value={tipoDoc}
                  onChange={(e) => setTipoDoc(e.target.value as TipoDocumento)}
                  disabled={modo === 'editar' && numPagos > 0}
                  title={modo === 'editar' && numPagos > 0 ? 'No se puede cambiar el tipo: la deuda ya tiene pagos' : undefined}
                  style={inputStyle}
                >
                  {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>

              <Field label="Centro de costo (opcional)">
                <select value={centroId} onChange={(e) => setCentroId(e.target.value)} style={inputStyle}>
                  <option value="">— Sin asignar —</option>
                  {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Field>

              <Field label="Fecha de emisión">
                <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} max={today} style={inputStyle} />
              </Field>

              <Field label="Moneda">
                <select value={moneda} onChange={(e) => setMoneda(e.target.value as 'Q' | 'USD')} style={inputStyle}>
                  <option value="Q">Q (GTQ)</option>
                  <option value="USD">USD</option>
                </select>
              </Field>

              {moneda === 'USD' && (
                <Field label="Tipo de cambio (USD → GTQ)">
                  <input type="number" step="0.01" min="0.01" value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} style={inputStyle} />
                </Field>
              )}

              <Field label={`Monto original (${moneda})`}>
                <input type="number" step="0.01" min="0.01" placeholder="0.00" value={montoOriginal} onChange={(e) => setMontoOriginal(e.target.value)} style={inputStyle} />
              </Field>

              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Nombre o descripción (opcional)">
                  <input type="text" placeholder="ej. Préstamo Banco Industrial 2026 · 48 cuotas" value={nombreDeuda} onChange={(e) => setNombreDeuda(e.target.value)} style={inputStyle} />
                </Field>
              </div>
            </div>
          </section>

          {/* DETALLES ESPECÍFICOS */}
          {(showTarjeta || showPrestamo || showFactoraje || showFactura || showPeriodico) && (
            <section style={{ background: 'var(--paper)', padding: 12, borderRadius: 6, border: '1px solid var(--line-3)' }}>
              <h3 style={sectionTitle}>Detalles específicos · {tipoDoc}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>

                {showTarjeta && (<>
                  <Field label="Límite de tarjeta"><input type="number" step="0.01" value={limite} onChange={(e) => setLimite(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Últimos 4 dígitos"><input type="text" maxLength={4} pattern="\d{4}" value={ultimos4} onChange={(e) => setUltimos4(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Tasa de interés anual (%)"><input type="number" step="0.01" placeholder="15.00" value={tasaInteresAnual} onChange={(e) => setTasaInteresAnual(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Día de pago fijo (1–31)"><input type="number" min="1" max="31" value={diaPagoFijo} onChange={(e) => setDiaPagoFijo(e.target.value)} style={inputStyle} /></Field>
                </>)}

                {showPrestamo && (<>
                  <Field label="Plazo en meses"><input type="number" min="1" value={plazoMeses} onChange={(e) => setPlazoMeses(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Fecha primera cuota"><input type="date" value={fechaPrimerCuota} onChange={(e) => setFechaPrimerCuota(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Tasa de interés anual (%)"><input type="number" step="0.01" placeholder="12.00" value={tasaInteresAnual} onChange={(e) => setTasaInteresAnual(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Fecha de vencimiento (auto-calculada si vacía)"><input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={inputStyle} /></Field>
                </>)}

                {showFactoraje && (<>
                  <Field label="Tasa de comisión (%)"><input type="number" step="0.01" value={tasaComision} onChange={(e) => setTasaComision(e.target.value)} style={inputStyle} /></Field>
                  <Field label="IVA sobre comisión (%)"><input type="number" step="0.01" placeholder="12" value={ivaComision} onChange={(e) => setIvaComision(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Reserva (%)"><input type="number" step="0.01" value={reserva} onChange={(e) => setReserva(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Plazo en días"><input type="number" min="1" value={plazoDias} onChange={(e) => setPlazoDias(e.target.value)} style={inputStyle} /></Field>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={conRecurso} onChange={(e) => setConRecurso(e.target.checked)} />
                      Con recurso (sigues siendo responsable si el cliente no paga)
                    </label>
                  </div>
                </>)}

                {showFactura && (<>
                  <Field label="Número de factura"><input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} style={inputStyle} /></Field>
                  <Field label="Plazo de crédito (días)"><input type="number" min="1" value={plazoCreditoDias} onChange={(e) => setPlazoCreditoDias(e.target.value)} style={inputStyle} /></Field>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Vencimiento (auto-calculado por plazo, o sobrescribí acá)"><input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={inputStyle} /></Field>
                  </div>
                </>)}

                {showPeriodico && (<>
                  <Field label="Fecha de vencimiento"><input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={inputStyle} /></Field>
                </>)}
              </div>
            </section>
          )}

          {/* NOTAS */}
          <Field label="Notas internas (opcional)">
            <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
          </Field>

          {/* ERRORES */}
          {errores.length > 0 && (
            <div style={{ padding: '8px 10px', background: 'rgba(138, 42, 42, 0.06)', border: '1px solid var(--wine)', borderRadius: 4, fontSize: 11.5, color: 'var(--wine)' }}>
              {errores.map((e, i) => <div key={i}>· {e}</div>)}
            </div>
          )}

          {/* RESUMEN */}
          {puedeEnviar && acreedorSeleccionado && (
            <div style={{ padding: '8px 10px', background: 'var(--paper)', border: '1px solid var(--line-3)', borderRadius: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>
              {modo === 'crear' ? 'Vas a crear' : 'Vas a actualizar'} una deuda con <strong>{acreedorSeleccionado.nombre || acreedorSeleccionado.nombreLegal}</strong>
              {' '}por <strong className="num">{moneda === 'Q' ? Q(monto) : `USD ${monto.toLocaleString('en-US')}`}</strong>
              {fechaVencimiento && <> con vencimiento {fechaVencimiento}</>}.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--line-3)', position: 'sticky', bottom: 0, background: 'var(--paper-2)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          {!confirmando ? (
            <button className="btn btn-primary" onClick={() => setConfirmando(true)} disabled={!puedeEnviar}>
              {modo === 'crear' ? 'Crear deuda' : 'Guardar cambios'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={enviar} disabled={enviando} style={{ background: 'var(--olive)' }}>
              {enviando ? 'Guardando...' : `Confirmar ${modo === 'crear' ? 'creación' : 'cambios'}`}
            </button>
          )}
        </div>
      </div>

      {subModalOpen && (
        <CrearAcreedorSubModal
          onClose={() => setSubModalOpen(false)}
          onCreado={handleAcreedorCreado}
        />
      )}
    </div>
  );
  return createPortal(body, document.body);
}

// ===========================================================================
// Sub-modal: crear acreedor inline
// ===========================================================================

interface SubModalProps {
  onClose: () => void;
  onCreado: (a: Acreedor) => void;
}

function CrearAcreedorSubModal({ onClose, onCreado }: SubModalProps) {
  const [nombre, setNombre] = useState('');
  const [tipoAcreedor, setTipoAcreedor] = useState<TipoAcreedor>('Proveedor');
  const [tipoProducto, setTipoProducto] = useState('');
  const [nombreLegal, setNombreLegal] = useState('');
  const [nit, setNit] = useState('');
  const [esRelacionada, setEsRelacionada] = useState(false);
  const [moneda, setMoneda] = useState<'Q' | 'USD'>('Q');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Si elige Socio, fuerza esRelacionada=true
  useEffect(() => {
    if (tipoAcreedor === 'Socio') setEsRelacionada(true);
  }, [tipoAcreedor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enviando]);

  const puedeEnviar = nombre.trim() && tipoAcreedor && !enviando;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setEnviando(true);
    try {
      const res = await crearAcreedorAction({
        nombreAcreedor: nombre.trim(),
        acreedorNombreLegal: nombreLegal.trim() || undefined,
        tipoProducto: tipoProducto || undefined,
        tipoAcreedor,
        esParteRelacionada: esRelacionada,
        nit: nit.trim() || undefined,
        moneda,
        email: email.trim() || undefined,
        telefono: telefono.trim() || undefined,
        notas: notas.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.mensaje);
        // Construir un Acreedor compatible (con datos mínimos del create)
        const nuevo: Acreedor = {
          id: res.acreedorId,
          nombre: nombre.trim(),
          nombreLegal: nombreLegal.trim() || nombre.trim(),
          tipoProducto: tipoProducto || '',
          tipoAcreedor,
          esParteRelacionada: esRelacionada,
          totalDeudaInicial: 0,
          moneda,
          estatus: 'Activo',
          cuentaContable: '',
          notas: notas.trim(),
        };
        onCreado(nuevo);
        onClose();
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14, 42, 36, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
        padding: 20,
      }}
    >
      <div className="card" style={{
        width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--paper-2)', padding: 0,
      }}>
        <div className="card-head" style={{ borderBottom: '1px solid var(--line-3)' }}>
          <div className="card-title">Crear acreedor</div>
          <button className="modal-close" onClick={onClose} disabled={enviando}><I.X size={14} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
          <Field label="Nombre del acreedor (requerido)">
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus style={inputStyle} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Tipo de acreedor">
              <select value={tipoAcreedor} onChange={(e) => setTipoAcreedor(e.target.value as TipoAcreedor)} style={inputStyle}>
                {TIPOS_ACREEDOR.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Tipo de producto (opcional)">
              <select value={tipoProducto} onChange={(e) => setTipoProducto(e.target.value)} style={inputStyle}>
                <option value="">— Sin asignar —</option>
                {TIPOS_PRODUCTO_ACREEDOR.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Razón social legal (opcional)">
              <input type="text" value={nombreLegal} onChange={(e) => setNombreLegal(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="NIT (opcional)">
              <input type="text" value={nit} onChange={(e) => setNit(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Moneda">
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as 'Q' | 'USD')} style={inputStyle}>
                <option value="Q">Q</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Email (opcional)">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Teléfono (opcional)">
              <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={esRelacionada} onChange={(e) => setEsRelacionada(e.target.checked)} disabled={tipoAcreedor === 'Socio'} />
            Es parte relacionada {tipoAcreedor === 'Socio' && <span style={{ color: 'var(--ink-4)' }}>(automático para Socio)</span>}
          </label>

          <Field label="Notas (opcional)">
            <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--line-3)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={!puedeEnviar}>
            {enviando ? 'Creando...' : 'Crear acreedor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Estilos compartidos
// ===========================================================================

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper)',
  fontFamily: 'inherit', color: 'var(--ink)', outline: 'none',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--ink-3)', fontWeight: 500, margin: 0,
};
const comboItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '6px 10px', background: 'transparent', border: 'none',
  cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)',
  borderBottom: '1px solid var(--line-3)',
};
const comboItemNuevo: React.CSSProperties = {
  ...comboItem,
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--olive)', fontWeight: 500, fontSize: 12,
  borderBottom: '2px solid var(--line-2)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}
