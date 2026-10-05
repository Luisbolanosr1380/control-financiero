'use client';

/**
 * Captura rápida: foto → campos mínimos → guardar. Sin lógica de negocio
 * propia: llama las server actions de alta que ya existen (cada una valida
 * su permiso en la primera línea) y muestra lo que devuelven.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileUp } from 'lucide-react';
import type { TipoCaptura } from '@/lib/movil/secciones';
import { enviarConReintentos, entornoNavegador } from '@/lib/movil/reintentos';
import { procesarFacturasAction } from '@/app/(app)/gastos/_actions/procesar-facturas';
import { crearFacturaAction } from '@/app/(app)/facturacion/nueva/actions';
import { registrarCobroAction } from '@/app/(app)/facturacion/[id]/actions';
import { comprimirImagen } from './comprimir-imagen';
import s from './movil.module.css';

interface Opcion { id: string; nombre: string }
interface FacturaCobrable { noFactura: string; cliente: string; saldo: number; fecha: string }
interface Props {
  tipos: TipoCaptura[];
  hoy: string;
  clientes: Opcion[];
  centros: Opcion[];
  bancos: Opcion[];
  facturas: FacturaCobrable[];
}

const TIPO_LABEL: Record<TipoCaptura, string> = { gasto: 'Gasto', factura: 'Factura', cobro: 'Cobro' };
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 4 * 1024 * 1024;   // límite de request de Vercel (4.5 MB) con margen
const METODOS = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta'] as const;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ivaDeTotal = (total: number) => round2((total * 12) / 112);   // IVA incluido (Guatemala), igual que el alta de escritorio
const num = (v: string) => Number(v.replace(/,/g, '').trim());
const Q = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Resultado = { ok: boolean; texto: string };

export function CapturaMovil({ tipos, hoy, clientes, centros, bancos, facturas }: Props) {
  const [tipo, setTipo] = useState<TipoCaptura>(tipos[0]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [estadoRed, setEstadoRed] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  // Factura
  const [custId, setCustId] = useState('');
  const [noFactura, setNoFactura] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [total, setTotal] = useState('');
  const [centroId, setCentroId] = useState(centros.length === 1 ? centros[0].id : '');
  // Cobro
  const [noFacturaCobro, setNoFacturaCobro] = useState('');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<(typeof METODOS)[number]>('Transferencia');
  const [bancoId, setBancoId] = useState(bancos[0]?.id ?? '');
  const [referencia, setReferencia] = useState('');
  const [buscar, setBuscar] = useState('');

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const facturaCobro = facturas.find(f => f.noFactura === noFacturaCobro) ?? null;
  const facturasFiltradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (q ? facturas.filter(f => f.noFactura.toLowerCase().includes(q) || f.cliente.toLowerCase().includes(q)) : facturas).slice(0, 60);
  }, [buscar, facturas]);

  const limpiar = () => {
    setArchivo(null); setPreview(null);
    setNoFactura(''); setTotal(''); setCustId('');
    setNoFacturaCobro(''); setMonto(''); setReferencia(''); setBuscar('');
  };

  const elegirArchivo = async (f: File | undefined) => {
    setResultado(null);
    if (!f) return;
    if (!TIPOS_ARCHIVO.includes(f.type)) {
      setResultado({ ok: false, texto: `Ese formato (${f.type || 'desconocido'}) no se puede subir. Usá una foto JPG/PNG o un PDF.` });
      return;
    }
    setPreparando(true);
    const listo = await comprimirImagen(f);
    setPreparando(false);
    if (listo.size > MAX_BYTES) {
      setResultado({ ok: false, texto: `El archivo pesa ${(listo.size / 1024 / 1024).toFixed(1)} MB; el máximo es 4 MB.` });
      return;
    }
    setArchivo(listo);
    setPreview(listo.type.startsWith('image/') ? URL.createObjectURL(listo) : null);
  };

  const totalNum = num(total);
  const montoNum = num(monto);
  const listo =
    !!archivo && !enviando && !preparando && (
      tipo === 'gasto' ||
      (tipo === 'factura' && !!custId && !!noFactura.trim() && !!fecha && totalNum > 0 && !!centroId) ||
      (tipo === 'cobro' && !!facturaCobro && montoNum > 0 && montoNum <= facturaCobro.saldo + 0.01 && !!bancoId && !!fecha)
    );

  const guardar = async () => {
    if (!archivo || !listo) return;
    setEnviando(true); setResultado(null); setEstadoRed(null);
    const fd = new FormData();
    let enviar: () => Promise<Resultado>;
    if (tipo === 'gasto') {
      fd.append('archivos', archivo, archivo.name);
      enviar = async () => {
        const r = await procesarFacturasAction(fd);
        if (r.creadas.length) {
          const c = r.creadas[0];
          return { ok: true, texto: `Gasto recibido: ${c.proveedor} · ${Q(c.total)}. Quedó en la bandeja de Gastos, pendiente de revisión y aprobación.` };
        }
        if (r.duplicadas.length) return { ok: false, texto: 'Ese documento ya estaba cargado (duplicado). No se subió de nuevo.' };
        return { ok: false, texto: r.errores[0]?.motivo ?? 'No se pudo procesar el documento.' };
      };
    } else if (tipo === 'factura') {
      fd.append('data', JSON.stringify({
        noFactura: noFactura.trim(), custId, fechaEmision: fecha,
        lineas: [{ centroCostoId: centroId, total: round2(totalNum), iva: ivaDeTotal(totalNum) }],
      }));
      fd.append('pdf', archivo, archivo.name);
      enviar = async () => {
        const r = await crearFacturaAction(fd);
        if (!r.ok) return { ok: false, texto: r.error };
        return { ok: true, texto: `Factura ${r.noFactura} registrada${r.pdfAdjuntado ? ' con la foto adjunta' : ''}.${r.aviso ? ` ${r.aviso}` : ''}` };
      };
    } else {
      fd.append('data', JSON.stringify({
        noFactura: noFacturaCobro, fecha,
        componentes: [{ monto: round2(montoNum), metodo, bancoId, referencia: referencia.trim() || undefined }],
      }));
      fd.append('constancia_0', archivo, archivo.name);
      enviar = async () => {
        const r = await registrarCobroAction(fd);
        if (!r.ok && r.cobrosCreados === 0) return { ok: false, texto: r.error ?? 'No se pudo registrar el cobro.' };
        return { ok: true, texto: `Cobro de ${Q(r.totalCobrado)} registrado en la factura ${r.noFactura}. Saldo: ${Q(r.saldoNuevo)}.${r.avisos?.length ? ` ${r.avisos.join(' ')}` : ''}` };
      };
    }

    const r = await enviarConReintentos(enviar, {
      idempotente: tipo !== 'cobro',
      entorno: entornoNavegador(),
      alEsperar: (motivo, n) => setEstadoRed(motivo === 'sin_conexion' ? 'Sin señal: se envía apenas vuelva la conexión.' : `Se cortó la conexión, reintentando (${n}/3)…`),
    });
    setEnviando(false); setEstadoRed(null);
    if (r.estado === 'ok') {
      setResultado(r.valor);
      if (r.valor.ok) limpiar();
    } else {
      setResultado({
        ok: false,
        texto: r.posibleGuardado
          ? 'Se cortó la conexión mientras se guardaba el cobro. Puede que sí se haya registrado: revisalo en la factura antes de intentar de nuevo.'
          : 'No hay conexión estable. El documento sigue acá: intentá de nuevo cuando tengas señal.',
      });
    }
  };

  return (
    <div className={s.captura}>
      {tipos.length > 1 && (
        <div className={s.tipos} role="tablist">
          {tipos.map(t => (
            <button key={t} type="button" role="tab" aria-selected={tipo === t}
              className={`${s.tipo} ${tipo === t ? s.tipoActivo : ''}`}
              onClick={() => { setTipo(t); setResultado(null); }}>
              {TIPO_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {resultado && <div className={resultado.ok ? s.resultadoOk : s.resultadoMal} role="status">{resultado.texto}</div>}
      {estadoRed && <div className={s.offline} role="status">{estadoRed}</div>}

      <input ref={camaraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void elegirArchivo(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={archivoRef} type="file" accept="image/*,application/pdf" hidden onChange={e => { void elegirArchivo(e.target.files?.[0]); e.target.value = ''; }} />

      {!archivo ? (
        <>
          <button type="button" className={s.camara} onClick={() => camaraRef.current?.click()} disabled={preparando}>
            <Camera size={36} strokeWidth={1.6} />
            {preparando ? 'Preparando foto…' : `Tomar foto ${tipo === 'cobro' ? 'del comprobante' : 'de la factura'}`}
          </button>
          <button type="button" className={s.linkBtn} onClick={() => archivoRef.current?.click()}>
            <FileUp size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />o elegir de la galería / un PDF
          </button>
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Documento capturado" className={s.preview} /> : null}
          <div className={s.archivoInfo}>
            <span>{archivo.name} · {(archivo.size / 1024).toFixed(0)} KB</span>
            <button type="button" className={s.linkBtn} onClick={() => { setArchivo(null); setPreview(null); }}>Cambiar</button>
          </div>
        </>
      )}

      {tipo === 'gasto' && (
        <div className={s.ayuda}>
          Los datos (proveedor, NIT, número, total) se leen solos de la foto. El gasto queda en la bandeja de <strong>Gastos</strong> para que Contador o Admin lo revise y apruebe.
        </div>
      )}

      {tipo === 'factura' && (
        <>
          <label className={s.campo}>
            <span className={s.etiqueta}>Cliente</span>
            <select className={s.input} value={custId} onChange={e => setCustId(e.target.value)}>
              <option value="">Elegí el cliente…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Número de factura</span>
            <input className={s.input} value={noFactura} onChange={e => setNoFactura(e.target.value)} autoCapitalize="characters" placeholder="Ej. A1B2C3D4-123456789" />
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Total con IVA</span>
            <input className={s.input} value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" />
            {totalNum > 0 && <span className={s.ayuda}>IVA incluido: {Q(ivaDeTotal(totalNum))}</span>}
          </label>
          {centros.length > 1 && (
            <label className={s.campo}>
              <span className={s.etiqueta}>Línea de negocio</span>
              <select className={s.input} value={centroId} onChange={e => setCentroId(e.target.value)}>
                <option value="">Elegí la línea…</option>
                {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <label className={s.campo}>
            <span className={s.etiqueta}>Fecha de emisión</span>
            <input className={s.input} type="date" value={fecha} max={hoy} onChange={e => setFecha(e.target.value)} />
          </label>
        </>
      )}

      {tipo === 'cobro' && (
        <>
          <label className={s.campo}>
            <span className={s.etiqueta}>Factura que se cobra</span>
            {facturas.length > 8 && (
              <input className={s.input} value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar por cliente o número" />
            )}
            <select className={s.input} value={noFacturaCobro} onChange={e => {
              setNoFacturaCobro(e.target.value);
              const f = facturas.find(x => x.noFactura === e.target.value);
              setMonto(f ? String(round2(f.saldo)) : '');
            }}>
              <option value="">{facturas.length ? 'Elegí la factura…' : 'No hay facturas con saldo'}</option>
              {facturasFiltradas.map(f => <option key={f.noFactura} value={f.noFactura}>{f.cliente} · {f.noFactura} · saldo {Q(f.saldo)}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Monto cobrado</span>
            <input className={s.input} value={monto} onChange={e => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" />
            {facturaCobro && montoNum > facturaCobro.saldo + 0.01 && <span className={s.ayuda} style={{ color: 'var(--wine)' }}>Es más que el saldo ({Q(facturaCobro.saldo)}).</span>}
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Forma de pago</span>
            <select className={s.input} value={metodo} onChange={e => setMetodo(e.target.value as (typeof METODOS)[number])}>
              {METODOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Banco donde entró</span>
            <select className={s.input} value={bancoId} onChange={e => setBancoId(e.target.value)}>
              {bancos.length === 0 && <option value="">No hay cuentas bancarias activas</option>}
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Referencia (opcional)</span>
            <input className={s.input} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="No. de transferencia o cheque" />
          </label>
          <label className={s.campo}>
            <span className={s.etiqueta}>Fecha del cobro</span>
            <input className={s.input} type="date" value={fecha} max={hoy} onChange={e => setFecha(e.target.value)} />
          </label>
        </>
      )}

      <button type="button" className={s.guardar} disabled={!listo} onClick={() => void guardar()}>
        {enviando ? 'Guardando…' : tipo === 'gasto' ? 'Enviar a la bandeja' : tipo === 'factura' ? 'Registrar factura' : 'Registrar cobro'}
      </button>
      {!archivo && <div className={s.ayuda} style={{ textAlign: 'center' }}>Primero la foto; después los datos.</div>}
    </div>
  );
}
