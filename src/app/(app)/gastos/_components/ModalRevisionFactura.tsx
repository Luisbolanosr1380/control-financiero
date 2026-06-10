'use client';

/**
 * F-050 PARTE E — Modal de revisión completo.
 *
 * Layout:
 *  - Header: proveedor + NIT + estatus.
 *  - Sección 1 (read-only): datos extraídos del OCR + badge confianza.
 *  - Sección 2 (collapsable): corrección de datos extraídos.
 *  - Sección 3 (form): proveedor (existente vs nuevo), CC, cuenta contable,
 *    tipo operativo, método pago. Side-effects al cambiar campos.
 *  - Sección 4 (sticky): preview del asiento con 3 partidas (Dr Gasto,
 *    Dr IVA si > 0, Cr Banco/CxP). Recalcula en vivo.
 *  - Footer: Aprobar / Anular / Cancelar.
 *
 * Limitaciones documentadas:
 *  - El selector de cuenta contable carga TODAS las cuentas (filtro de
 *    TIPO_ESTADO ⊃ "ER" + NATURALEZA_ER = "Deudora" requiere field IDs
 *    pendientes via MCP). El usuario filtra por search del código.
 *  - Período cerrado: el detector vive server-side; el preview muestra
 *    el período de la fecha de emisión sin distinguir abierto/cerrado.
 *    El backend (resolverPeriodoContable) decide el ajuste real al
 *    aprobar y lo refleja en la respuesta.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { anularFacturaAction } from '@/app/(app)/gastos/_actions/anular-factura';
import { aprobarFacturaAction } from '@/app/(app)/gastos/_actions/aprobar-factura';
import { buscarProveedorPorNitAction } from '@/app/(app)/gastos/_actions/buscar-proveedor-por-nit';
import { cargarOpcionesModalAction, type OpcionesModal, type OpcionSelector } from '@/app/(app)/gastos/_actions/cargar-opciones-modal';
import { CUENTAS_SISTEMA } from '@/lib/contabilidad/cuentas-sistema';
import type { FacturaIn } from '@/lib/db/facturas-in';

interface Props {
  factura: FacturaIn;
  onClose: () => void;
}

type EstadoProveedor =
  | { tipo: 'idle' }
  | { tipo: 'buscando' }
  | { tipo: 'existe'; recordId: string; nombre: string }
  | { tipo: 'no_existe' }
  | { tipo: 'error'; mensaje: string };

type MetodoPago = 'Contado' | 'Plazo';
type TipoOp = 'Operativo' | 'No Operativo';

function hoyISO(): string {
  const ahora = new Date();
  const guate = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
  const y = guate.getUTCFullYear();
  const m = String(guate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(guate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sumarDias(fechaIso: string, dias: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fechaIso)) return fechaIso;
  const [y, m, d] = fechaIso.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

export function ModalRevisionFactura({ factura, onClose }: Props) {
  const router = useRouter();

  // Opciones de selectores (centros / cuentas / bancos).
  const [opciones, setOpciones] = useState<OpcionesModal | null>(null);
  const [opcionesError, setOpcionesError] = useState<string | null>(null);

  // Sección 2 — corrección de datos. Default cerrada salvo confianza baja.
  const confianzaBaja = (factura.confianzaExtraccion ?? 1) < 0.8;
  const [corrigiendo, setCorrigiendo] = useState(confianzaBaja);
  const [proveedorNombre, setProveedorNombre] = useState(factura.proveedorNombre);
  const [proveedorNit, setProveedorNit] = useState(factura.proveedorNit);
  const [serie, setSerie] = useState(factura.serie);
  const [numero, setNumero] = useState(factura.numero);
  const [fechaEmision, setFechaEmision] = useState(factura.fechaEmision);
  const [base, setBase] = useState(String(factura.subtotal ?? 0));
  const [iva, setIva] = useState(String(factura.iva ?? 0));
  const [total, setTotal] = useState(String(factura.total ?? 0));

  const baseNum  = Number(base);
  const ivaNum   = Number(iva);
  const totalNum = Number(total);

  const restaurarOriginales = () => {
    setProveedorNombre(factura.proveedorNombre);
    setProveedorNit(factura.proveedorNit);
    setSerie(factura.serie);
    setNumero(factura.numero);
    setFechaEmision(factura.fechaEmision);
    setBase(String(factura.subtotal ?? 0));
    setIva(String(factura.iva ?? 0));
    setTotal(String(factura.total ?? 0));
  };

  // Sección 3 — proveedor (existente vs nuevo).
  const [estadoProveedor, setEstadoProveedor] = useState<EstadoProveedor>({ tipo: 'idle' });
  const [provEmail, setProvEmail] = useState('');
  const [provTelefono, setProvTelefono] = useState('');
  const [provDireccion, setProvDireccion] = useState('');

  // Sección 3 — selectores.
  const [centroCostoId, setCentroCostoId] = useState('');
  const [categoriaGastoId, setCategoriaGastoId] = useState('');
  const [searchCuenta, setSearchCuenta] = useState('');
  const [tipoOperativo, setTipoOperativo] = useState<TipoOp>('Operativo');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('Plazo');
  const [bancoId, setBancoId] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [fechaVencimiento, setFechaVencimiento] = useState(sumarDias(factura.fechaEmision || hoyISO(), 30));
  const [referenciaPago, setReferenciaPago] = useState('');
  const [proveedorInternacional, setProveedorInternacional] = useState(false);

  // Sub-modo anulación + estado de submit.
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [motivoAnul, setMotivoAnul] = useState('');
  const [loading, setLoading] = useState(false);

  // Cargar opciones al montar.
  useEffect(() => {
    let cancelado = false;
    cargarOpcionesModalAction()
      .then(opc => { if (!cancelado) setOpciones(opc); })
      .catch(err => { if (!cancelado) setOpcionesError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelado = true; };
  }, []);

  // Buscar proveedor por NIT al cambiar (debounce mínimo).
  useEffect(() => {
    if (!proveedorNit.trim()) {
      setEstadoProveedor({ tipo: 'idle' });
      return;
    }
    let cancelado = false;
    setEstadoProveedor({ tipo: 'buscando' });
    const tid = setTimeout(async () => {
      try {
        const res = await buscarProveedorPorNitAction(proveedorNit);
        if (cancelado) return;
        if (res.existe && res.recordId) {
          setEstadoProveedor({ tipo: 'existe', recordId: res.recordId, nombre: res.nombre ?? proveedorNombre });
        } else {
          setEstadoProveedor({ tipo: 'no_existe' });
        }
      } catch (err) {
        if (!cancelado) setEstadoProveedor({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) });
      }
    }, 400);
    return () => { cancelado = true; clearTimeout(tid); };
  }, [proveedorNit, proveedorNombre]);

  // Cuentas filtradas por search.
  const cuentasFiltradas = useMemo(() => {
    if (!opciones) return [];
    const q = searchCuenta.toLowerCase().trim();
    if (!q) return opciones.cuentasGasto;
    return opciones.cuentasGasto.filter(c => c.label.toLowerCase().includes(q));
  }, [opciones, searchCuenta]);

  // Validaciones para habilitar "Aprobar".
  const cuentaGastoLabel = useMemo(() => {
    if (!opciones) return '';
    return opciones.cuentasGasto.find(c => c.id === categoriaGastoId)?.label ?? '';
  }, [opciones, categoriaGastoId]);

  const errores = useMemo(() => {
    const e: string[] = [];
    if (!centroCostoId)    e.push('Falta centro de costo.');
    if (!categoriaGastoId) e.push('Falta cuenta contable de gasto.');
    if (metodoPago === 'Contado' && !bancoId) e.push('Falta banco (método Contado).');
    if (metodoPago === 'Contado' && !fechaPago) e.push('Falta fecha de pago.');
    if (metodoPago === 'Plazo' && !fechaVencimiento) e.push('Falta fecha de vencimiento.');
    if (estadoProveedor.tipo === 'idle' || estadoProveedor.tipo === 'buscando') e.push('Esperando resolución de proveedor…');
    if (!fechaEmision) e.push('Falta fecha de emisión.');
    if (!(totalNum > 0)) e.push('Total debe ser > 0.');
    return e;
  }, [centroCostoId, categoriaGastoId, metodoPago, bancoId, fechaPago, fechaVencimiento, estadoProveedor, fechaEmision, totalNum]);

  const puedeAprobar = errores.length === 0 && !loading;

  if (typeof document === 'undefined') return null;

  const aprobar = async () => {
    if (!puedeAprobar) return;
    setLoading(true);
    try {
      const proveedorId = estadoProveedor.tipo === 'existe' ? estadoProveedor.recordId : undefined;
      const proveedorDatosParaCrear = estadoProveedor.tipo === 'no_existe'
        ? {
            nombre: proveedorNombre.trim() || '(Sin nombre)',
            nit: proveedorNit.trim(),
            email: provEmail.trim() || undefined,
            telefono: provTelefono.trim() || undefined,
            direccion: provDireccion.trim() || undefined,
          }
        : undefined;

      const res = await aprobarFacturaAction({
        facturaInId: factura.id,
        proveedorId,
        proveedorDatosParaCrear,
        centroCostoId,
        categoriaGastoId,
        tipoOperativo,
        metodoPago,
        bancoId: metodoPago === 'Contado' ? bancoId : undefined,
        fechaPago: metodoPago === 'Contado' ? fechaPago : undefined,
        fechaVencimiento: metodoPago === 'Plazo' ? fechaVencimiento : undefined,
        referenciaPago: metodoPago === 'Contado' ? referenciaPago : undefined,
        proveedorEsInternacional: proveedorInternacional,
        datosCorregidos: corrigiendo
          ? {
              proveedorNombre,
              proveedorNit,
              serie,
              numero,
              fechaEmision,
              base: baseNum,
              iva: ivaNum,
              total: totalNum,
            }
          : undefined,
      });

      if (res.ok) {
        const accion = res.periodoAjustado
          ? `Asiento ${res.asientoRef} creado (ajustado al período actual por cierre)`
          : `Asiento ${res.asientoRef} creado`;
        toast.success(`Factura aprobada · ${accion}.`, { duration: 6000 });
        if (res.error) toast.warning(res.error, { duration: 10000 });
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo aprobar la factura.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de red.');
    } finally {
      setLoading(false);
    }
  };

  const anular = async () => {
    if (motivoAnul.trim().length < 5) {
      toast.error('Motivo mínimo 5 caracteres.');
      return;
    }
    setLoading(true);
    try {
      const res = await anularFacturaAction({ facturaInId: factura.id, motivo: motivoAnul.trim() });
      if (res.ok) {
        toast.success('Factura anulada.');
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo anular.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Preview del asiento.
  const periodoEmision = (fechaEmision || '').slice(0, 7);
  const previewPartidas = useMemo(() => {
    const partidas: Array<{ cuenta: string; debe: number; haber: number }> = [];
    partidas.push({ cuenta: cuentaGastoLabel || 'Cuenta de gasto seleccionada', debe: baseNum || 0, haber: 0 });
    if (ivaNum > 0) {
      partidas.push({ cuenta: `${CUENTAS_SISTEMA.IVA_CREDITO_FISCAL.codigo} · ${CUENTAS_SISTEMA.IVA_CREDITO_FISCAL.nombre}`, debe: ivaNum, haber: 0 });
    }
    if (metodoPago === 'Contado') {
      const banco = opciones?.bancos.find(b => b.id === bancoId);
      partidas.push({ cuenta: `Banco · ${banco?.label ?? '(elegir banco)'}`, debe: 0, haber: totalNum || 0 });
    } else {
      const cxp = proveedorInternacional
        ? CUENTAS_SISTEMA.CXP_PROVEEDORES_INTERNACIONALES
        : CUENTAS_SISTEMA.CXP_PROVEEDORES_NACIONALES;
      partidas.push({ cuenta: `${cxp.codigo} · ${cxp.nombre}`, debe: 0, haber: totalNum || 0 });
    }
    return partidas;
  }, [cuentaGastoLabel, baseNum, ivaNum, totalNum, metodoPago, bancoId, opciones, proveedorInternacional]);

  const totalDebe  = previewPartidas.reduce((s, p) => s + p.debe, 0);
  const totalHaber = previewPartidas.reduce((s, p) => s + p.haber, 0);
  const balanceado = Math.abs(totalDebe - totalHaber) < 0.01;

  return createPortal(
    <div
      onClick={() => { if (!loading) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 3vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1140px, 96vw)', maxHeight: '94vh', overflow: 'hidden',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          display: 'grid', gridTemplateColumns: '1fr 360px', gridTemplateRows: 'auto 1fr auto',
          gap: 0,
        }}
      >
        {/* Header (ocupa 2 cols) */}
        <div style={{ gridColumn: '1 / -1', padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Revisión · {factura.proveedorNombre || factura.proveedorNit || 'Sin proveedor'} · {Q(factura.total)}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar">
            <I.X size={14} />
          </button>
        </div>

        {/* Columna izquierda: secciones 1-3 (scrollable) */}
        <div style={{ overflowY: 'auto', padding: 16, borderRight: '1px solid var(--line-3)' }}>
          {/* Sección 1 — Datos extraídos */}
          <div style={{ marginBottom: 16 }}>
            <SectionTitle>Datos extraídos</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 12.5 }}>
              <Campo label="Proveedor" valor={factura.proveedorNombre || '—'} />
              <Campo label="NIT" valor={factura.proveedorNit || '—'} />
              <Campo label="Tipo doc" valor={factura.tipoDoc || '—'} />
              <Campo label="Serie / Número" valor={`${factura.serie || '—'} / ${factura.numero || '—'}`} />
              <Campo label="Fecha emisión" valor={factura.fechaEmision ? formatearFecha(factura.fechaEmision) : '—'} />
              <Campo label="Total" valor={Q(factura.total)} strong />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, fontSize: 11 }}>
              {factura.archivoUrl && (
                <a href={factura.archivoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  📄 PDF original
                </a>
              )}
              {typeof factura.confianzaExtraccion === 'number' && (
                <span style={{ color: 'var(--ink-4)' }}>
                  · Confianza: {(factura.confianzaExtraccion * 100).toFixed(0)}%
                  {factura.datosNormalizadosOk ? ' · cross-check OK ✓' : ' · cross-check con flags ⚠'}
                </span>
              )}
            </div>
          </div>

          {/* Sección 2 — Corrección de datos */}
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setCorrigiendo(c => !c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-3)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span style={{ transform: corrigiendo ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▸</span>
              Corregir datos extraídos
              {confianzaBaja && <span className="badge badge-warn" style={{ fontSize: 9 }}>recomendado (confianza baja)</span>}
            </button>
            {corrigiendo && (
              <div style={{ marginTop: 10, padding: 12, background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <CampoEdit label="Proveedor" value={proveedorNombre} onChange={setProveedorNombre} />
                  <CampoEdit label="NIT" value={proveedorNit} onChange={setProveedorNit} />
                  <CampoEdit label="Serie" value={serie} onChange={setSerie} />
                  <CampoEdit label="Número" value={numero} onChange={setNumero} />
                  <CampoEdit label="Fecha emisión (YYYY-MM-DD)" value={fechaEmision} onChange={setFechaEmision} />
                  <CampoEdit label="Subtotal" value={base} onChange={setBase} type="number" />
                  <CampoEdit label="IVA" value={iva} onChange={setIva} type="number" />
                  <CampoEdit label="Total" value={total} onChange={setTotal} type="number" />
                </div>
                <button type="button" onClick={restaurarOriginales} style={{ fontSize: 11, marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}>
                  Restaurar valores originales
                </button>
              </div>
            )}
          </div>

          {/* Sección 3 — Decisiones */}
          <SectionTitle>Decisiones</SectionTitle>

          {opcionesError ? (
            <div style={{ padding: 12, background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4, fontSize: 12, color: 'var(--wine)' }}>
              Error cargando opciones del modal: {opcionesError}
            </div>
          ) : !opciones ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Cargando opciones…</div>
          ) : (
            <>
              {/* 3.1 Proveedor */}
              <SubSection title="Proveedor">
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>
                  Detectado: <strong>{proveedorNombre || '—'}</strong> · NIT {proveedorNit || '—'}
                </div>
                {estadoProveedor.tipo === 'buscando' && <Banner kind="info">Buscando coincidencia por NIT…</Banner>}
                {estadoProveedor.tipo === 'existe' && (
                  <Banner kind="ok">✓ Existe: <strong>{estadoProveedor.nombre}</strong> — se vinculará.</Banner>
                )}
                {estadoProveedor.tipo === 'no_existe' && (
                  <div>
                    <Banner kind="warn">⚠ No existe en PROVEEDORES — se creará con los datos sugeridos.</Banner>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                      <CampoEdit label="Email" value={provEmail} onChange={setProvEmail} />
                      <CampoEdit label="Teléfono" value={provTelefono} onChange={setProvTelefono} />
                      <CampoEdit label="Dirección" value={provDireccion} onChange={setProvDireccion} />
                    </div>
                  </div>
                )}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>
                  <input type="checkbox" checked={proveedorInternacional} onChange={(e) => setProveedorInternacional(e.target.checked)} />
                  Proveedor internacional (afecta cuenta CxP usada)
                </label>
              </SubSection>

              {/* 3.2 Centro de Costo */}
              <SubSection title="Centro de Costo (obligatorio)">
                <select value={centroCostoId} onChange={(e) => setCentroCostoId(e.target.value)} className="input">
                  <option value="">— Elegí un centro de costo —</option>
                  {opciones.centrosCosto.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </SubSection>

              {/* 3.3 Cuenta contable */}
              <SubSection title="Cuenta contable de gasto (obligatorio)">
                <input
                  type="text"
                  className="input"
                  placeholder="Filtrar por código o nombre…"
                  value={searchCuenta}
                  onChange={(e) => setSearchCuenta(e.target.value)}
                  style={{ marginBottom: 6 }}
                />
                <select
                  value={categoriaGastoId}
                  onChange={(e) => setCategoriaGastoId(e.target.value)}
                  className="input"
                  size={6}
                  style={{ height: 'auto' }}
                >
                  {cuentasFiltradas.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                  {opciones.cuentasGasto.length} cuentas cargadas · sin pre-filtro automático (CUENTAS field IDs pendientes).
                </div>
              </SubSection>

              {/* 3.4 Tipo Operativo */}
              <SubSection title="Tipo (obligatorio)">
                <div style={{ display: 'flex', gap: 6 }}>
                  <ToggleBtn active={tipoOperativo === 'Operativo'} onClick={() => setTipoOperativo('Operativo')}>Operativo</ToggleBtn>
                  <ToggleBtn active={tipoOperativo === 'No Operativo'} onClick={() => setTipoOperativo('No Operativo')}>No Operativo</ToggleBtn>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                  Operativo = gasto del giro normal del negocio. No Operativo = extraordinario / fiscal.
                </div>
              </SubSection>

              {/* 3.5 Método de pago */}
              <SubSection title="Método de pago (obligatorio)">
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <ToggleBtn active={metodoPago === 'Contado'} onClick={() => setMetodoPago('Contado')}>Contado</ToggleBtn>
                  <ToggleBtn active={metodoPago === 'Plazo'} onClick={() => setMetodoPago('Plazo')}>Plazo (CxP)</ToggleBtn>
                </div>
                {metodoPago === 'Contado' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <Label>Banco</Label>
                      <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} className="input">
                        <option value="">— Elegí banco —</option>
                        {opciones.bancos.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {opciones.bancosSinCuenta.length > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 4 }}>
                          ⚠ {opciones.bancosSinCuenta.length} banco(s) ocultos por falta de CUENTA_CONTABLE
                        </div>
                      )}
                    </div>
                    <CampoEdit label="Fecha pago" value={fechaPago} onChange={setFechaPago} type="date" />
                    <CampoEdit label="Referencia (opcional)" value={referenciaPago} onChange={setReferenciaPago} />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                    <CampoEdit label="Vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} type="date" />
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '20px 0' }}>
                      La factura quedará como Cuenta por Pagar hasta que se registre el pago.
                    </div>
                  </div>
                )}
              </SubSection>
            </>
          )}

          {/* Anular inline */}
          {pidiendoMotivo && (
            <div style={{ marginTop: 14, padding: 12, background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Motivo de anulación (mín. 5 chars):</div>
              <input type="text" className="input" value={motivoAnul} onChange={(e) => setMotivoAnul(e.target.value)} placeholder="Ej. PDF ilegible, factura duplicada…" autoFocus />
            </div>
          )}
        </div>

        {/* Columna derecha: Preview asiento (sticky) */}
        <div style={{ overflowY: 'auto', padding: 16, background: 'var(--paper-2)' }}>
          <SectionTitle>Preview del asiento</SectionTitle>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.6 }}>
            <div><strong>Fecha:</strong> {formatearFecha(fechaEmision)}</div>
            <div><strong>Período:</strong> {periodoEmision || '—'}</div>
            <div><strong>Origen:</strong> FACTURA COMPRA</div>
            <div><strong>CC:</strong> {opciones?.centrosCosto.find(c => c.id === centroCostoId)?.label ?? '(elegir)'}</div>
            <div><strong>Proveedor:</strong> {proveedorNombre || '—'}</div>
          </div>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line-2)' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--ink-4)' }}>Cuenta</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink-4)' }}>Debe</th>
                <th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink-4)' }}>Haber</th>
              </tr>
            </thead>
            <tbody>
              {previewPartidas.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
                  <td style={{ padding: '4px 0', color: 'var(--ink-2)' }}>{p.cuenta}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '4px 0' }}>{p.debe > 0 ? Q(p.debe) : ''}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '4px 0' }}>{p.haber > 0 ? Q(p.haber) : ''}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--ink-3)' }}>
                <td style={{ padding: '6px 0', fontWeight: 600 }}>TOTALES</td>
                <td className="num" style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>{Q(totalDebe)}</td>
                <td className="num" style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>{Q(totalHaber)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 12, color: balanceado ? 'var(--olive)' : 'var(--wine)' }}>
            {balanceado ? '✓ Balanceado' : `⚠ Diferencia ${Q(Math.abs(totalDebe - totalHaber))}`}
          </div>

          {errores.length > 0 && (
            <div style={{ marginTop: 12, padding: 8, background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4, fontSize: 11, color: 'var(--wine)' }}>
              {errores.map(e => <div key={e}>• {e}</div>)}
            </div>
          )}
        </div>

        {/* Footer (ocupa 2 cols) */}
        <div style={{ gridColumn: '1 / -1', padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          {!pidiendoMotivo ? (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--wine)' }} onClick={() => setPidiendoMotivo(true)} disabled={loading}>
              Anular…
            </button>
          ) : (
            <button type="button" className="btn btn-danger" onClick={anular} disabled={loading || motivoAnul.trim().length < 5}>
              {loading ? 'Anulando…' : 'Confirmar anulación'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={aprobar}
            disabled={!puedeAprobar}
            title={errores[0]}
          >
            {loading ? 'Aprobando…' : 'Aprobar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ============================================================ helpers UI */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
      {children}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, padding: 10, background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{children}</div>;
}

function Campo({ label, valor, strong }: { label: string; valor: string; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: strong ? 14 : 12.5, fontWeight: strong ? 500 : 400, color: strong ? 'var(--ink)' : 'var(--ink-2)', marginTop: 2 }}>
        {valor || '—'}
      </div>
    </div>
  );
}

function CampoEdit({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 10px', fontSize: 12,
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-3)',
        border: '1px solid var(--line-2)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function Banner({ kind, children }: { kind: 'info' | 'ok' | 'warn'; children: React.ReactNode }) {
  const styles = {
    info: { bg: 'var(--paper-2)',  bd: 'var(--line-2)', fg: 'var(--ink-2)' },
    ok:   { bg: '#E8EDDE',         bd: 'var(--olive)',  fg: 'var(--ink)' },
    warn: { bg: '#FBF1DC',         bd: 'var(--amber)',  fg: 'var(--ink-2)' },
  }[kind];
  return (
    <div style={{ padding: '6px 10px', background: styles.bg, border: `1px solid ${styles.bd}`, borderRadius: 4, fontSize: 11.5, color: styles.fg }}>
      {children}
    </div>
  );
}
