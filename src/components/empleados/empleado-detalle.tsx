'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { ModalEmpleadoForm } from './modal-empleado-form';
import { ModalDarDeBaja } from './modal-dar-de-baja';
import { ModalDeudaSalarial } from './modal-deuda-salarial';
import type { Empleado } from '@/lib/db/empleados';
import type { Deuda } from '@/lib/db/deudas';
import type { EstadoPagoLinea, EstadoPeriodo } from '@/lib/db/planillas';

export interface LineaPlanillaHistorico {
  periodoId: string;
  periodoNombre: string;
  mes: number;
  anio: number;
  quincena: 1 | 2;
  estadoPeriodo: EstadoPeriodo;
  fechaFinPeriodo: string;
  lineaId: string;
  fechaPago?: string;
  netoPagar: number;
  igssLaboral: number;
  isr: number;
  estadoPago: EstadoPagoLinea;
}

interface Props {
  empleado: Empleado;
  deudasSalariales: Deuda[];
  centros: Array<{ id: string; nombre: string }>;
  departamentos: string[];
  historicoPlanillas?: LineaPlanillaHistorico[];
}

function formatFecha(s: string | undefined): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function EmpleadoDetalle({ empleado: e, deudasSalariales, centros, departamentos, historicoPlanillas }: Props) {
  const router = useRouter();
  const [editar, setEditar] = useState(false);
  const [darBaja, setDarBaja] = useState(false);
  const [crearDeuda, setCrearDeuda] = useState(false);

  const inactivo = e.status !== 'ACTIVO';
  const deudasActivas = deudasSalariales.filter(d => !/liquidada/i.test(d.estadoDeuda));
  const totalDeudasActivas = deudasActivas.reduce((s, d) => s + d.saldoPendiente, 0);

  // Histórico de planillas — últimas 12 líneas ordenadas más reciente primero.
  const historico = (historicoPlanillas ?? [])
    .slice()
    .sort((a, b) => {
      if (a.anio !== b.anio) return b.anio - a.anio;
      if (a.mes !== b.mes)   return b.mes - a.mes;
      return b.quincena - a.quincena;
    });
  const historicoTop = historico.slice(0, 12);
  const anioActual = new Date().getFullYear();
  const deAnio = historico.filter(h => h.anio === anioActual && h.estadoPago === 'Pagado');
  const totalPagadoAnio = deAnio.reduce((s, h) => s + h.netoPagar, 0);
  const totalIgssAnio = deAnio.reduce((s, h) => s + h.igssLaboral, 0);
  const totalIsrAnio = deAnio.reduce((s, h) => s + h.isr, 0);

  const statusBadge =
    e.status === 'ACTIVO'   ? { cls: 'badge-olive',   text: 'Activo' }
    : e.status === 'INACTIVO' ? { cls: 'badge-mute',  text: 'Inactivo' }
    : e.status === 'DESPIDO'  ? { cls: 'badge-wine',  text: 'Despido' }
    : e.status === 'RENUNCIA' ? { cls: 'badge-mute',  text: 'Renuncia' }
    :                           { cls: 'badge-wine',  text: e.status };

  const quincenaSugerida = Math.round((e.salarioMensual / 2) * 100) / 100;

  return (
    <div className="page">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/empleados" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver a empleados
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 24 }}>{e.nombre}</h1>
            <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{e.departamento}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>· Antigüedad: {e.antiguedad.textoLegible}</span>
          </div>
          <div className="page-subtitle" style={{ marginTop: 4 }}>
            Ingreso {formatDate(e.fechaIngreso)}
            {e.fechaSalida && <> · Salida {formatDate(e.fechaSalida)}{e.motivoSalida && ` (${e.motivoSalida})`}</>}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setEditar(true)}><I.Edit size={13} /> Editar</button>
          {!inactivo && (
            <button className="btn btn-secondary" onClick={() => setDarBaja(true)} style={{ color: 'var(--wine)' }}>
              <I.X size={13} /> Dar de baja
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Kpi label="Salario mensual"        value={Q(e.salarioMensual)} />
        <Kpi label="Costo total mensual"    value={Q(e.costoTotalMensual)} hint="con prestaciones e IGSS" />
        <Kpi label="Indemnización potencial" value={Q(e.provisionesAcumuladas.indemnizacionPotencial)} hint="al día de hoy" />
        <Kpi label="Costo por hora"          value={Q(e.costoXHora)} />
      </div>

      {/* Datos personales y bancarios */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginBottom: 22 }}>
        <div className="card">
          <div className="card-head"><div className="card-title">Datos personales</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <Dato label="Documento" valor={e.numeroDocumento ?? '—'} />
            <Dato label="Departamento" valor={e.departamento} />
            <Dato label="Centro de costo" valor={e.centroCostoNombre ?? '—'} />
            <Dato label="Sede" valor={e.sede ?? '—'} />
            <Dato label="ID puesto" valor={e.idPuesto ?? '—'} />
            <Dato label="Tipo contrato" valor={e.tipoContrato ?? '—'} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Datos bancarios</div>
            {(!e.bancoNombre || !e.cuentaBancaria) && (
              <div className="card-actions">
                <span className="badge badge-warn" style={{ fontSize: 10 }}>⚠️ Incompletos</span>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <Dato label="Banco" valor={e.bancoNombre ?? '—'} />
            <Dato label="Cuenta" valor={e.cuentaBancaria ?? '—'} />
            <Dato label="Acreedor vinculado" valor={e.acreedorVinculadoId ? '✓ Sí' : '—'} extra={e.acreedorVinculadoId ? 'creado al diferir primera quincena' : 'se crea cuando se difiere una quincena'} />
          </div>
        </div>
      </div>

      {/* Composición salarial + provisión mensual */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head"><div className="card-title">Composición salarial y prestaciones (mensual)</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: '1px solid var(--line-3)' }}>
          <Dato label="Salario base"            valor={Q(e.salarioBase)} />
          <Dato label="Bonificación incentivo"  valor={Q(e.bonificacionIncentivo)} />
          <Dato label="Bono variable"           valor={Q(e.bonoVariable)} />
          <Dato label="Salario mensual"         valor={Q(e.salarioMensual)} extra="base + bonif + bono" />
          <Dato label="IGSS patronal (12.67%)"  valor={Q(e.igssPatronal)} />
          <Dato label="Bono 14 (8.33%)"         valor={Q(e.provisionBono14)} />
          <Dato label="Aguinaldo (8.33%)"       valor={Q(e.provisionAguinaldo)} />
          <Dato label="Vacaciones (4.17%)"      valor={Q(e.provisionVacaciones)} />
          <Dato label="Indemnización (9.72%)"   valor={Q(e.provisionIndemnizacion)} />
          <Dato label="Costo total mensual"     valor={Q(e.costoTotalMensual)} extra="con prestaciones" />
        </div>
      </div>

      {/* Provisiones ACUMULADAS al día */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Prestaciones acumuladas al día</div>
          <div className="card-actions">
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Lo que la empresa le debe HOY si tuviera que liquidar (sin contar indemnización si renuncia)</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid var(--line-3)' }}>
          <Dato label="Bono 14"            valor={Q(e.provisionesAcumuladas.bono14)} />
          <Dato label="Aguinaldo"          valor={Q(e.provisionesAcumuladas.aguinaldo)} />
          <Dato label="Vacaciones"         valor={Q(e.provisionesAcumuladas.vacaciones.valorMonetario)} extra={`${e.provisionesAcumuladas.vacaciones.diasAcumulados.toFixed(1)} días`} />
          <Dato label="Indemnización potencial" valor={Q(e.provisionesAcumuladas.indemnizacionPotencial)} extra="solo si despido sin responsabilidad" />
          <Dato label="Total pasivo laboral" valor={Q(e.provisionesAcumuladas.totalPasivoLaboral)} extra="suma de prestaciones" />
        </div>
      </div>

      {/* SALARIOS PENDIENTES (F-037) */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Salarios pendientes</div>
          <div className="card-actions">
            {deudasActivas.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--wine)', fontWeight: 500 }}>
                Total activo: <span className="num">{Q(totalDeudasActivas)}</span>
              </span>
            )}
            {!inactivo && (
              <button className="btn btn-secondary" onClick={() => setCrearDeuda(true)} style={{ marginLeft: 8 }}>
                <I.Plus size={13} /> Registrar deuda salarial
              </button>
            )}
          </div>
        </div>
        {deudasSalariales.length === 0 ? (
          <div className="card-pad" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            Sin salarios pendientes. Cuando se difiera una quincena, aparecerá aquí.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 110 }}>Fecha quincena</th>
                <th className="num">Monto</th>
                <th className="num">Saldo</th>
                <th>Estado</th>
                <th className="num">Días mora</th>
                <th>Notas</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {deudasSalariales.map(d => {
                const liquidada = /liquidada/i.test(d.estadoDeuda);
                return (
                  <tr key={d.id} style={{ opacity: liquidada ? 0.55 : 1 }}>
                    <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatFecha(d.fechaEmision)}</td>
                    <td className="num">{Q(d.montoOriginal)}</td>
                    <td className="num cell-strong" style={{ color: d.saldoPendiente > 0 ? 'var(--wine)' : 'var(--olive)' }}>
                      {Q(d.saldoPendiente)}
                    </td>
                    <td>
                      <span className={`badge ${liquidada ? 'badge-olive' : d.diasEnMora > 0 ? 'badge-wine' : 'badge-outline'}`}>
                        {d.estadoDeuda}
                      </span>
                    </td>
                    <td className="num cell-mute">{d.diasEnMora > 0 ? d.diasEnMora : '—'}</td>
                    <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={d.notas}>{d.notas || '—'}</td>
                    <td>
                      <Link href={`/deudas/${d.id}`} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }}>
                        Ver →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* HISTORIAL DE PLANILLAS (F-038) */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Historial de planillas</div>
          <div className="card-actions">
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Últimas 12 quincenas registradas
            </span>
          </div>
        </div>
        {historicoTop.length === 0 ? (
          <div className="card-pad" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            Sin líneas de planilla todavía. Cuando se genere una planilla, aparecerá aquí.
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="num" style={{ width: 110 }}>Fecha pago</th>
                  <th className="num">Neto pagado</th>
                  <th className="num">IGSS retenido</th>
                  <th className="num">ISR retenido</th>
                  <th>Estado pago</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {historicoTop.map(h => {
                  const badgeCls =
                    h.estadoPago === 'Pagado'    ? 'badge-olive'
                    : h.estadoPago === 'Diferido' ? 'badge-wine'
                    :                              'badge-outline';
                  return (
                    <tr key={h.lineaId}>
                      <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{h.periodoNombre}</td>
                      <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatFecha(h.fechaPago)}</td>
                      <td className="num cell-strong">{Q(h.netoPagar)}</td>
                      <td className="num cell-mute">{Q(h.igssLaboral)}</td>
                      <td className="num cell-mute">{Q(h.isr)}</td>
                      <td>
                        <span className={`badge ${badgeCls}`}>{h.estadoPago}</span>
                      </td>
                      <td>
                        <Link href={`/planillas/${h.periodoId}`} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }}>
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 18, padding: '14px 18px', borderTop: '1px solid var(--line-3)', fontSize: 12, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--ink-3)' }}>
                  Total pagado este año <strong className="num" style={{ color: 'var(--ink)' }}>{Q(totalPagadoAnio)}</strong>
                </span>
                <span style={{ color: 'var(--ink-3)' }}>
                  IGSS año <strong className="num" style={{ color: 'var(--ink)' }}>{Q(totalIgssAnio)}</strong>
                </span>
                <span style={{ color: 'var(--ink-3)' }}>
                  ISR año <strong className="num" style={{ color: 'var(--ink)' }}>{Q(totalIsrAnio)}</strong>
                </span>
              </div>
              {historico[0] && (
                <Link href={`/planillas/${historico[0].periodoId}`} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>
                  Ver planilla completa →
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      {editar && (
        <ModalEmpleadoForm modo="editar" empleado={e} centros={centros} departamentos={departamentos} onClose={() => setEditar(false)} />
      )}
      {darBaja && (
        <ModalDarDeBaja empleado={e} onClose={() => setDarBaja(false)} />
      )}
      {crearDeuda && (
        <ModalDeudaSalarial
          empleadoId={e.id}
          empleadoNombre={e.nombre}
          salarioSugerido={quincenaSugerida}
          onClose={() => { setCrearDeuda(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}

function Dato({ label, valor, extra }: { label: string; valor: string; extra?: string }) {
  return (
    <div style={{ padding: '12px 18px', borderRight: '1px solid var(--line-3)', borderBottom: '1px solid var(--line-3)' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>{valor}</div>
      {extra && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{extra}</div>}
    </div>
  );
}
