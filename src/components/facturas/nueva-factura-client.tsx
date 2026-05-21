'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { crearFacturaAction } from '@/app/(app)/facturacion/nueva/actions';
import type { Customer } from '@/lib/types';
import type { CentroCosto } from '@/lib/db/centros';

// Monto se maneja como string (texto crudo) mientras se escribe; se parsea para cálculos.
const parseNum = (s: string): number => {
  const n = parseFloat(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
// IVA incluido (Guatemala): se extrae del total con IVA → total * 12 / 112
const ivaDeTotal = (total: number) => round2((total * 12) / 112);

const formSchema = z.object({
  noFactura: z.string().trim().min(1, 'NO.FACTURA es requerido'),
  custId: z.string().min(1, 'Elegí un cliente'),
  fechaEmision: z.string().min(1, 'Fecha de emisión requerida'),
  lineas: z.array(z.object({
    centroCostoId: z.string().min(1, 'Elegí un centro'),
    total: z.string().refine(s => parseNum(s) > 0, 'Total debe ser > 0'),
    iva: z.string().refine(s => parseNum(s) >= 0, 'IVA inválido'),
  })).min(1, 'Agregá al menos una línea'),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  clientes: Customer[];
  centros: CentroCosto[];
}

export function NuevaFacturaClient({ clientes, centros }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [clienteQuery, setClienteQuery] = useState('');
  const [clienteOpen, setClienteOpen] = useState(false);

  const {
    register, handleSubmit, control, setValue, watch, formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      noFactura: '',
      custId: '',
      fechaEmision: new Date().toISOString().slice(0, 10),
      lineas: [{ centroCostoId: '', total: '', iva: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  const custId = watch('custId');
  const clienteSel = clientes.find(c => c.id === custId);
  const lineas = watch('lineas');

  const filtrados = clienteQuery.trim()
    ? clientes.filter(c => c.name.toLowerCase().includes(clienteQuery.toLowerCase())).slice(0, 20)
    : clientes.slice(0, 20);

  // Sumas (parseando los strings de cada línea)
  let sumTotal = 0, sumIva = 0;
  for (const l of lineas ?? []) {
    sumTotal += parseNum(l?.total) || 0;
    sumIva += parseNum(l?.iva) || 0;
  }
  const sumSub = sumTotal - sumIva;

  const onSubmit = async (values: FormValues) => {
    setPending(true);
    const res = await crearFacturaAction({
      noFactura: values.noFactura,
      custId: values.custId,
      fechaEmision: values.fechaEmision,
      lineas: values.lineas.map(l => ({
        centroCostoId: l.centroCostoId,
        total: parseNum(l.total),
        iva: parseNum(l.iva),
      })),
    });
    setPending(false);
    if (res.ok) {
      toast.success(`Factura ${res.noFactura} registrada · ${res.recordsCreados} línea(s)`);
      router.push('/facturacion');
      router.refresh();
    } else if (res.duplicado) {
      toast.warning(res.error);
    } else {
      toast.error(res.error);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Registrar factura</h1>
          <div className="page-subtitle">
            La factura la emite SAT/FEL; acá se <strong>registra</strong> para control interno. El monto es el <strong>total con IVA</strong> tal cual aparece en la factura.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => router.push('/facturacion')}>
            <I.ChevLeft size={13} /> Volver al listado
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Encabezado (overflow visible para que el dropdown del cliente flote sobre la tabla) */}
        <div className="card" style={{ marginBottom: 18, overflow: 'visible' }}>
          <div className="card-pad" style={{ overflow: 'visible' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">No. Factura (SAT)</label>
                <input className="input num" placeholder="Ej. 2050314195" {...register('noFactura')} />
                {errors.noFactura && <FieldError msg={errors.noFactura.message} />}
              </div>

              <div className="field" style={{ margin: 0, position: 'relative' }}>
                <label className="label">Cliente</label>
                <input
                  className="input"
                  placeholder="Buscar cliente…"
                  value={clienteOpen ? clienteQuery : (clienteSel?.name ?? '')}
                  onFocusCapture={() => { setClienteOpen(true); setClienteQuery(''); }}
                  onChange={(e) => { setClienteQuery(e.target.value); setClienteOpen(true); }}
                  onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
                />
                {clienteOpen && (
                  <div style={{
                    position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0, marginTop: 4,
                    background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                    maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                  }}>
                    {filtrados.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink-4)' }}>Sin resultados</div>
                    ) : filtrados.map(c => (
                      <button
                        type="button"
                        key={c.id}
                        onMouseDown={(e) => { e.preventDefault(); setValue('custId', c.id, { shouldValidate: true }); setClienteOpen(false); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                          fontSize: 12.5, color: 'var(--ink)', background: c.id === custId ? 'var(--bg-2)' : 'transparent', border: 'none', cursor: 'pointer',
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {errors.custId && <FieldError msg={errors.custId.message} />}
              </div>

              <div className="field" style={{ margin: 0 }}>
                <label className="label">Fecha de emisión</label>
                <input type="date" className="input num" {...register('fechaEmision')} />
                {errors.fechaEmision && <FieldError msg={errors.fechaEmision.message} />}
              </div>
            </div>
          </div>
        </div>

        {/* Editor de líneas */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">
            <div className="card-title">Líneas / centros de costo</div>
            <div className="card-actions">
              <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => append({ centroCostoId: '', total: '', iva: '' })}>
                <I.Plus size={12} /> Agregar línea
              </button>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Centro de costo</th>
                  <th className="num" style={{ width: 160 }}>Total (con IVA)</th>
                  <th className="num" style={{ width: 150 }}>IVA</th>
                  <th className="num" style={{ width: 150 }}>Subtotal (ref.)</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const total = parseNum(lineas?.[i]?.total) || 0;
                  const iva = parseNum(lineas?.[i]?.iva) || 0;
                  const subtotal = round2(total - iva);
                  const lineErr = errors.lineas?.[i];
                  return (
                    <tr key={f.id}>
                      <td>
                        <select className="input" {...register(`lineas.${i}.centroCostoId`)} defaultValue="">
                          <option value="" disabled>Elegí un centro…</option>
                          {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        {lineErr?.centroCostoId && <FieldError msg={lineErr.centroCostoId.message} />}
                      </td>
                      <td>
                        <input
                          type="text" inputMode="decimal" className="input num" style={{ textAlign: 'right' }}
                          placeholder="0.00"
                          {...register(`lineas.${i}.total`, {
                            onBlur: (e) => {
                              const t = parseNum(e.target.value);
                              setValue(`lineas.${i}.iva`, Number.isFinite(t) ? String(ivaDeTotal(t)) : '', { shouldValidate: true });
                            },
                          })}
                        />
                        {lineErr?.total && <FieldError msg={lineErr.total.message} />}
                      </td>
                      <td>
                        <input
                          type="text" inputMode="decimal" className="input num" style={{ textAlign: 'right' }}
                          placeholder="0.00"
                          {...register(`lineas.${i}.iva`)}
                        />
                        {lineErr?.iva && <FieldError msg={lineErr.iva.message} />}
                      </td>
                      <td className="num cell-mute" style={{ textAlign: 'right' }}>{Q(subtotal)}</td>
                      <td>
                        {fields.length > 1 && (
                          <button type="button" className="modal-close" onClick={() => remove(i)} title="Eliminar línea">
                            <I.Trash size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {typeof errors.lineas?.message === 'string' && (
            <div className="card-pad" style={{ paddingTop: 0 }}><FieldError msg={errors.lineas.message} /></div>
          )}
        </div>

        {/* Totales + envío */}
        <div className="card">
          <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 28 }}>
              <Total label="Subtotal" value={sumSub} />
              <Total label="IVA" value={sumIva} />
              <Total label="Total" value={sumTotal} strong />
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => router.push('/facturacion')} disabled={pending}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? 'Registrando…' : <><I.Check size={13} /> Registrar factura</>}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div style={{ fontSize: 11, color: 'var(--wine)', marginTop: 4 }}>{msg}</div>;
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div className="num" style={{ fontSize: strong ? 20 : 15, fontWeight: strong ? 600 : 500, color: strong ? 'var(--ink)' : 'var(--ink-2)' }}>{Q(value)}</div>
    </div>
  );
}
