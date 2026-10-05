'use client';

import { useState } from 'react';
import type { ClienteCobrar } from '@/lib/resumen/cobrar';
import type { PendientesCobro } from '@/lib/db/facturas-pendientes';
import s from './movil.module.css';

const Q = (n: number) => `Q${Math.round(n).toLocaleString('en-US')}`;
const estado = (dias: number) => (dias > 0 ? `vencida hace ${dias} día${dias === 1 ? '' : 's'}` : dias === 0 ? 'vence hoy' : `vence en ${-dias} día${dias === -1 ? '' : 's'}`);
const PRIMEROS = 25;

export function ListaCobrar({ clientes, totales }: { clientes: ClienteCobrar[]; totales: PendientesCobro['totales'] }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);
  const visibles = todos ? clientes : clientes.slice(0, PRIMEROS);

  return (
    <div className={s.resumen}>
      <div className={s.tarjetasDos}>
        <div className={s.tarjeta} aria-label="Total por cobrar"><div className={s.tarjetaEtiqueta}>Por cobrar</div><div className={s.tarjetaValorChico}>{Q(totales.saldoTotalQ)}</div></div>
        <div className={s.tarjeta}><div className={s.tarjetaEtiqueta}>Vencido</div><div className={`${s.tarjetaValorChico} ${totales.saldoVencidoQ > 0 ? s.rojo : ''}`}>{Q(totales.saldoVencidoQ)}</div></div>
      </div>
      {totales.numCedidas > 0 && (
        <p className={s.ayuda}>No incluye {totales.numCedidas} factura{totales.numCedidas === 1 ? '' : 's'} cedida{totales.numCedidas === 1 ? '' : 's'} a factoraje ({Q(totales.saldoCedidoQ)}): las cobra el financiador.</p>
      )}

      {clientes.length === 0 ? (
        <div className={s.alertaOk}>No hay facturas pendientes de cobro.</div>
      ) : (
        <ul className={s.listaClientes} aria-label="Clientes por cobrar">
          {visibles.map(c => {
            const k = c.cliente;
            const abiertoAqui = abierto === k;
            return (
              <li key={k}>
                <button type="button" className={s.filaCliente} aria-expanded={abiertoAqui} onClick={() => setAbierto(abiertoAqui ? null : k)}>
                  <span className={s.filaClienteNombre}>
                    {c.cliente}
                    <small>{c.facturas.length} factura{c.facturas.length === 1 ? '' : 's'} · {c.vencido > 0 ? <span className={s.rojo}>{estado(c.maxDiasVencidos)}</span> : estado(c.maxDiasVencidos)}</small>
                  </span>
                  <span className={s.filaClienteMonto}>
                    {Q(c.saldo)}
                    {c.vencido > 0 && c.vencido < c.saldo && <small className={s.rojo}>{Q(c.vencido)} vencido</small>}
                  </span>
                </button>
                {abiertoAqui && (
                  <ul className={s.facturasCliente}>
                    {c.facturas.map(f => (
                      <li key={f.noFactura}>
                        <span>Fact. {f.noFactura}<small className={f.diasVencidos > 0 ? s.rojo : ''}>{estado(f.diasVencidos)}</small></span>
                        <span className={s.num}>{Q(f.saldo)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!todos && clientes.length > PRIMEROS && (
        <button type="button" className={s.linkBtn} onClick={() => setTodos(true)}>Ver los {clientes.length} clientes</button>
      )}
    </div>
  );
}
