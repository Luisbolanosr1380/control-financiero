/* ===================== Cobros (payment list) ===================== */

function PaymentsList({ navigate, openRegister }) {
  const { Q, CUSTOMERS, formatDateShort } = window.MOCK;

  // Synthetic recent payments
  const payments = [
    { id: "REC-2026-0188", date: "2026-05-17", custId: "C-005", amount: 47260, method: "Transferencia", bank: "BAC",        ref: "TRF-93481" },
    { id: "REC-2026-0187", date: "2026-05-16", custId: "C-009", amount: 24800, method: "Cheque",        bank: "Banrural",   ref: "CHQ-0421" },
    { id: "REC-2026-0186", date: "2026-05-14", custId: "C-010", amount: 35280, method: "Transferencia", bank: "Industrial", ref: "TRF-93120" },
    { id: "REC-2026-0185", date: "2026-05-12", custId: "C-006", amount: 12600, method: "Depósito",      bank: "Cuscatlán",  ref: "DEP-1289" },
    { id: "REC-2026-0184", date: "2026-05-09", custId: "C-008", amount: 18900, method: "Transferencia", bank: "BAC",        ref: "TRF-92840" },
    { id: "REC-2026-0183", date: "2026-05-07", custId: "C-004", amount: 29400, method: "Transferencia", bank: "BAC",        ref: "TRF-92703" },
    { id: "REC-2026-0182", date: "2026-05-05", custId: "C-007", amount: 14200, method: "Cheque",        bank: "Banrural",   ref: "CHQ-0418" },
  ];
  const totalMes = payments.reduce((s, p) => s + p.amount, 0);
  const custById = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cobros</h1>
          <div className="page-subtitle">
            <span className="num">{payments.length}</span> recibos · <span className="num">{Q(totalMes)}</span> aplicados en mayo · <span style={{color:"var(--wine)"}}>−18.4% vs marzo</span>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13}/> Exportar</button>
          <button className="btn btn-primary" onClick={openRegister}><I.Plus size={13}/> Registrar cobro</button>
        </div>
      </div>

      <div className="kpi-grid" style={{gridTemplateColumns:"repeat(4, 1fr)", marginBottom:22}}>
        <div className="kpi">
          <div className="kpi-label">Cobrado · mayo</div>
          <div className="kpi-value"><span className="currency">Q</span>184,000</div>
          <div className="kpi-delta neg"><I.ArrowDown size={11}/> 7.1% <span className="vs">vs abril</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Tasa de cobranza global</div>
          <div className="kpi-value"><span className="num">41.5</span><span style={{fontSize:14, color:"var(--ink-3)", marginLeft:2}}>%</span></div>
          <div className="kpi-delta neg"><I.ArrowDown size={11}/> 4.2 pts <span className="vs">vs Q1</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Días promedio cobro</div>
          <div className="kpi-value"><span className="num">52</span><span style={{fontSize:14, color:"var(--ink-3)", marginLeft:2}}>d</span></div>
          <div className="kpi-delta neg"><span className="vs">vs 30 acordados</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Anticipos sin aplicar</div>
          <div className="kpi-value"><span className="currency">Q</span>14,820</div>
          <div className="kpi-delta"><span className="vs">3 clientes</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recibos recientes</div>
          <div className="card-actions">
            <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11}}>Mayo 2026 <I.ChevDown size={11}/></button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Recibo</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Banco</th>
              <th>Método</th>
              <th>Referencia</th>
              <th className="num">Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="clickable">
                <td className="num cell-strong">{p.id}</td>
                <td className="num cell-mute">{formatDateShort(p.date)}</td>
                <td className="cell-strong">{custById[p.custId].short}</td>
                <td>{p.bank}</td>
                <td>{p.method}</td>
                <td className="num cell-mute">{p.ref}</td>
                <td className="num cell-strong" style={{color:"var(--olive)"}}>+{Q(p.amount)}</td>
                <td><button className="modal-close"><I.More size={14}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Asientos (Journal) ===================== */

function JournalScreen() {
  const { Q, formatDateShort } = window.MOCK;
  const entries = [
    { id: "AS-2026-1881", date: "2026-05-19", concept: "Facturación · F-2026-0724 · Banrural",      debe: 28400,  haber: 28400,  cc: "TalentTrack", status: "borrador" },
    { id: "AS-2026-1880", date: "2026-05-17", concept: "Cobro · REC-2026-0188 · BAC Credomatic",    debe: 47260,  haber: 47260,  cc: "TalentTrack", status: "registrado" },
    { id: "AS-2026-1879", date: "2026-05-17", concept: "Pago planilla · 1ra quincena mayo",         debe: 184500, haber: 184500, cc: "Operación",   status: "registrado" },
    { id: "AS-2026-1878", date: "2026-05-16", concept: "Gasto · Servicios profesionales asesoría",  debe: 14000,  haber: 14000,  cc: "Operación",   status: "registrado" },
    { id: "AS-2026-1877", date: "2026-05-16", concept: "Cobro · REC-2026-0187 · GTLogistics",       debe: 24800,  haber: 24800,  cc: "Socioeco.",   status: "registrado" },
    { id: "AS-2026-1876", date: "2026-05-15", concept: "Provisión · Estimación cuentas incobrables",debe: 142000, haber: 142000, cc: "—",           status: "registrado" },
    { id: "AS-2026-1875", date: "2026-05-15", concept: "Renta oficinas · mayo 2026",                debe: 28000,  haber: 28000,  cc: "Operación",   status: "registrado" },
    { id: "AS-2026-1874", date: "2026-05-14", concept: "Facturación · F-2026-0721 · Procesadora",   debe: 35280,  haber: 35280,  cc: "Socioeco.",   status: "registrado" },
  ];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Asientos contables</h1>
          <div className="page-subtitle"><span className="num">1,881</span> asientos en 2026 · 3 borradores pendientes · Cierre de mayo en 11 días</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13}/> Libro diario</button>
          <button className="btn btn-secondary">Balance de comprobación</button>
          <button className="btn btn-primary"><I.Plus size={13}/> Asiento manual</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{color:"var(--ink-4)"}}/>
          <input placeholder="Folio, cuenta, concepto…"/>
        </div>
        <button className="filter-chip active">Mayo 2026</button>
        <button className="filter-chip">Tipo</button>
        <button className="filter-chip">Cuenta</button>
        <button className="filter-chip">Centro de costo</button>
        <div style={{marginLeft:"auto", fontSize:11.5, color:"var(--ink-3)"}}>
          Total mayo: <span className="num" style={{color:"var(--ink)"}}>{Q(entries.reduce((s,e)=>s+e.debe,0))}</span>
        </div>
      </div>

      <div className="table-wrap" style={{borderRadius:"0 0 var(--r-3) var(--r-3)", borderTop:"none"}}>
        <table className="table">
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Centro</th>
              <th className="num">Debe</th>
              <th className="num">Haber</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="clickable">
                <td className="num cell-strong">{e.id}</td>
                <td className="num cell-mute">{formatDateShort(e.date)}</td>
                <td className="cell-strong">{e.concept}</td>
                <td className="cell-mute">{e.cc}</td>
                <td className="num cell-strong">{Q(e.debe)}</td>
                <td className="num cell-strong">{Q(e.haber)}</td>
                <td>
                  <span className={"badge " + (e.status === "borrador" ? "badge-warn" : "badge-olive")}>
                    {e.status === "borrador" ? "Borrador" : "Registrado"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Generic placeholder pages ===================== */

function ComingSoon({ title, subtitle, icon }) {
  const Ico = I[icon] || I.Statement;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="card" style={{padding:80, textAlign:"center"}}>
        <div style={{width:56, height:56, borderRadius:14, background:"var(--bg-2)", color:"var(--ink-3)", display:"grid", placeItems:"center", margin:"0 auto 18px"}}>
          <Ico size={26}/>
        </div>
        <div className="serif" style={{fontSize:22, color:"var(--ink)", letterSpacing:"-0.01em", marginBottom:8}}>
          Módulo en construcción
        </div>
        <div style={{fontSize:13, color:"var(--ink-3)", maxWidth:440, margin:"0 auto", lineHeight:1.55}}>
          Este módulo está parte del roadmap de Q3 2026. El prototipo actual cubre <strong style={{color:"var(--ink)"}}>Facturación</strong>, <strong style={{color:"var(--ink)"}}>Cobros</strong>, <strong style={{color:"var(--ink)"}}>Clientes</strong>, <strong style={{color:"var(--ink)"}}>Asientos</strong> y el <strong style={{color:"var(--ink)"}}>Asistente AI</strong>.
        </div>
      </div>
    </div>
  );
}

/* ===================== Estados financieros (mini real screen) ===================== */

function StatementsScreen() {
  const { Q } = window.MOCK;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Estados financieros</h1>
          <div className="page-subtitle">Periodo · Mayo 2026 · Vista preliminar antes del cierre</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary">Comparar períodos</button>
          <button className="btn btn-secondary"><I.Download size={13}/> Descargar Excel</button>
          <button className="btn btn-primary">Generar PDF firmado</button>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:20}}>
        {/* Estado de Resultados */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Estado de Resultados</div>
            <span className="badge badge-mute">Preliminar</span>
          </div>
          <div style={{padding:"4px 0"}}>
            {[
              { label: "Ingresos por servicios", value: 281200,  positive: true, bold: true },
              { label: "  · Polígrafo",           value: 124800,  indent: true },
              { label: "  · Socioeconómico",      value: 98400,   indent: true },
              { label: "  · TalentTrack",        value: 45700,   indent: true },
              { label: "  · Ventas",              value: 12300,   indent: true },
              { label: "Costo de servicios",    value: -148200, },
              { label: "Utilidad bruta",          value:  133000, bold: true, divider: true },
              { label: "Gastos operativos",      value: -78600, },
              { label: "  · Planilla",            value: -52400,  indent: true },
              { label: "  · Renta y servicios",  value: -14200,  indent: true },
              { label: "  · Otros",               value: -12000,  indent: true },
              { label: "Utilidad operativa",     value:   54400, bold: true, divider: true },
              { label: "Estimación incobrables", value: -28000 },
              { label: "Gastos financieros",     value:  -8600 },
              { label: "Utilidad neta",           value:   17800, bold: true, divider: true, big: true },
            ].map((r, i) => (
              <div key={i} style={{
                display:"flex", justifyContent:"space-between",
                padding: r.big ? "12px 22px" : "5px 22px",
                borderBottom: r.divider ? "1px solid var(--line-3)" : "none",
                borderTop: r.divider ? "1px solid var(--line-3)" : "none",
                background: r.big ? "var(--bg-2)" : "transparent",
                fontSize: r.big ? 14 : 12.5,
                color: r.indent ? "var(--ink-3)" : "var(--ink-2)",
                fontWeight: r.bold ? 600 : 400,
                marginTop: r.divider && !r.big ? 4 : 0
              }}>
                <span>{r.label}</span>
                <span className="num" style={{color: r.bold ? "var(--ink)" : (r.value < 0 ? "var(--ink-3)" : "var(--ink-2)")}}>
                  {r.value < 0 ? "(" + Q(Math.abs(r.value)) + ")" : Q(r.value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Balance General resumen */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Balance General · Resumen</div>
            <span className="badge badge-mute">Al 31 May</span>
          </div>
          <div style={{padding:"4px 0"}}>
            {[
              { label: "ACTIVO", header: true },
              { label: "Activo circulante",      value:  2148000, bold: true },
              { label: "  · Caja y bancos",       value:    234000, indent: true },
              { label: "  · Clientes",            value:   1614094, indent: true },
              { label: "  · Anticipos a prov.",   value:    298000, indent: true },
              { label: "Activo no circulante",   value:   942000, bold: true, divider: true },
              { label: "Total activo",            value:   3090000, bold: true, big: true },
              { label: "PASIVO Y CAPITAL", header: true },
              { label: "Pasivo corto plazo",     value:    684000, bold: true },
              { label: "Pasivo largo plazo",     value:    520000, bold: true, divider: true },
              { label: "Capital social",          value:   1500000, bold: true },
              { label: "Resultados acumulados",  value:    386000, bold: true, divider: true },
              { label: "Total pasivo + capital", value:   3090000, bold: true, big: true },
            ].map((r, i) => (
              <div key={i} style={{
                display:"flex", justifyContent:"space-between",
                padding: r.big ? "12px 22px" : r.header ? "12px 22px 6px" : "5px 22px",
                borderTop: r.divider ? "1px solid var(--line-3)" : (r.header && i > 0 ? "1px solid var(--line-3)" : "none"),
                background: r.big ? "var(--bg-2)" : "transparent",
                fontSize: r.header ? 10 : (r.big ? 14 : 12.5),
                color: r.header ? "var(--ink-4)" : (r.indent ? "var(--ink-3)" : "var(--ink-2)"),
                fontWeight: r.bold || r.header ? 600 : 400,
                letterSpacing: r.header ? "0.1em" : "0",
                textTransform: r.header ? "uppercase" : "none",
              }}>
                <span>{r.label}</span>
                {!r.header && <span className="num" style={{color: r.bold ? "var(--ink)" : "var(--ink-2)"}}>{Q(r.value)}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.PaymentsList = PaymentsList;
window.JournalScreen = JournalScreen;
window.ComingSoon = ComingSoon;
window.StatementsScreen = StatementsScreen;
