/* ===================== Invoice list ===================== */

function InvoicesList({ navigate }) {
  const { Q, INVOICES, CUSTOMERS, LINES, formatDateShort } = window.MOCK;
  const [tab, setTab] = React.useState("todas");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState(new Set());

  const custById = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]));

  const counts = {
    todas:      INVOICES.length,
    vencidas:   INVOICES.filter(i => i.status === "vencido").length,
    por_cobrar: INVOICES.filter(i => i.status === "por_cobrar").length,
    cobradas:   INVOICES.filter(i => i.status === "cobrado").length,
    anuladas:   0,
  };

  let rows = INVOICES;
  if (tab === "vencidas")   rows = rows.filter(i => i.status === "vencido");
  if (tab === "por_cobrar") rows = rows.filter(i => i.status === "por_cobrar");
  if (tab === "cobradas")   rows = rows.filter(i => i.status === "cobrado");
  if (tab === "anuladas")   rows = [];

  if (search) {
    rows = rows.filter(i =>
      i.id.toLowerCase().includes(search.toLowerCase()) ||
      custById[i.custId].name.toLowerCase().includes(search.toLowerCase())
    );
  }

  const totalSaldo = rows.reduce((s, i) => s + i.balance, 0);
  const totalFact  = rows.reduce((s, i) => s + i.total, 0);

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Facturación</h1>
          <div className="page-subtitle">
            <span className="num">{counts.todas}</span> facturas · <span className="num">Q2,760,696</span> facturado · <span className="num" style={{color:"var(--wine)"}}>Q1,614,094</span> por cobrar
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <button className="btn btn-secondary"><I.Mail size={13} /> Recordatorios masivos</button>
          <button className="btn btn-primary" onClick={() => navigate("invoice-new")}>
            <I.Plus size={13} /> Nueva factura <span className="kbd">⌘N</span>
          </button>
        </div>
      </div>

      {/* Alerta crítica */}
      <div className="alert-banner">
        <div className="alert-icon">!</div>
        <div className="alert-text">
          <strong>Q1.11M en cartera +90 días</strong> · 317 facturas concentradas en 12 clientes. La gestión de cobro proactiva podría recuperar <span className="num">~Q420K</span> en los próximos 30 días.
        </div>
        <button className="btn btn-danger" onClick={() => navigate("ai")}>Plan de recuperación</button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={"tab" + (tab === "todas" ? " active" : "")} onClick={() => setTab("todas")}>
          Todas <span className="tab-count num">{counts.todas}</span>
        </button>
        <button className={"tab" + (tab === "vencidas" ? " active" : "")} onClick={() => setTab("vencidas")}>
          Vencidas <span className="tab-count num">{counts.vencidas}</span>
        </button>
        <button className={"tab" + (tab === "por_cobrar" ? " active" : "")} onClick={() => setTab("por_cobrar")}>
          Por cobrar <span className="tab-count num">{counts.por_cobrar}</span>
        </button>
        <button className={"tab" + (tab === "cobradas" ? " active" : "")} onClick={() => setTab("cobradas")}>
          Cobradas <span className="tab-count num">{counts.cobradas}</span>
        </button>
        <button className={"tab" + (tab === "anuladas" ? " active" : "")} onClick={() => setTab("anuladas")}>
          Anuladas <span className="tab-count num">{counts.anuladas}</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{color:"var(--ink-4)"}} />
          <input placeholder="Factura, cliente, NIT…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="filter-chip"><I.Filter size={11} /> Centro de costo</button>
        <button className="filter-chip active">Estado: {tab}</button>
        <button className="filter-chip">Cliente</button>
        <button className="filter-chip">Aging</button>
        <button className="filter-chip"><I.Calendar size={11} /> Emisión: últimos 90d</button>
        <div style={{marginLeft:"auto", display:"flex", gap:8, alignItems:"center", fontSize:11.5, color:"var(--ink-3)"}}>
          <span>{rows.length} resultados</span>
          <span style={{color:"var(--line-2)"}}>·</span>
          <span className="num">Total: {Q(totalSaldo)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap" style={{borderRadius: "0 0 var(--r-3) var(--r-3)", borderTop: "none"}}>
        <table className="table">
          <thead>
            <tr>
              <th style={{width:34}}>
                <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
              </th>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Centro</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th className="num">Total</th>
              <th className="num">Saldo</th>
              <th>Aging</th>
              <th>Estado</th>
              <th style={{width:40}}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="11" style={{height: 200, textAlign:"center", color:"var(--ink-4)"}}>
                <div style={{padding: 40}}>
                  <I.Receipt size={28} style={{opacity:0.4, marginBottom:8}}/>
                  <div style={{fontSize:13}}>No hay facturas en esta vista</div>
                </div>
              </td></tr>
            ) : rows.map(inv => {
              const cust = custById[inv.custId];
              const line = LINES[inv.line];
              const today = new Date(2026, 4, 19);
              const emisionDate = new Date(today); emisionDate.setDate(emisionDate.getDate() - inv.emisionAgo);
              const dueDate = new Date(today); dueDate.setDate(dueDate.getDate() - inv.dueAgo);

              let agingBadge, agingDays = inv.dueAgo;
              if (inv.status === "cobrado") agingBadge = { cls: "badge-olive", text: "Pagada" };
              else if (agingDays > 90) agingBadge = { cls: "badge-wine", text: `+90 d` };
              else if (agingDays > 60) agingBadge = { cls: "badge-wine", text: `${agingDays} d` };
              else if (agingDays > 30) agingBadge = { cls: "badge-warn", text: `${agingDays} d` };
              else if (agingDays > 0)  agingBadge = { cls: "badge-warn", text: `${agingDays} d` };
              else                     agingBadge = { cls: "badge-mute", text: `${Math.abs(agingDays)} d` };

              const statusBadge = {
                vencido:    { cls: "badge-wine",  text: "Vencida" },
                por_cobrar: { cls: "badge-outline", text: "Por cobrar" },
                cobrado:    { cls: "badge-olive", text: "Cobrada" },
              }[inv.status];

              return (
                <tr key={inv.id} className="clickable" onClick={() => navigate("invoice-detail", { invoiceId: inv.id })}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => {
                      const s = new Set(selected);
                      if (s.has(inv.id)) s.delete(inv.id); else s.add(inv.id);
                      setSelected(s);
                    }} />
                  </td>
                  <td className="num cell-strong">{inv.id}</td>
                  <td className="cell-strong">{cust.short}</td>
                  <td>
                    <span style={{display:"inline-flex", alignItems:"center", gap:6, fontSize:12}}>
                      <span className={"dot " + line.dot}></span>{line.name}
                    </span>
                  </td>
                  <td className="num cell-mute">{formatDateShort(emisionDate)}</td>
                  <td className="num">{formatDateShort(dueDate)}</td>
                  <td className="num cell-strong">{Q(inv.total)}</td>
                  <td className="num cell-strong">{Q(inv.balance)}</td>
                  <td><span className={"badge " + agingBadge.cls}>{agingBadge.text}</span></td>
                  <td><span className={"badge " + statusBadge.cls}>{statusBadge.text}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className="modal-close"><I.More size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>Mostrando <span className="num">1–{rows.length}</span> de <span className="num">{counts.todas}</span></span>
          <div style={{marginLeft:"auto", display:"flex", gap:4, alignItems:"center"}}>
            <button className="page-btn"><I.ChevLeft size={12} /></button>
            <button className="page-btn active">1</button>
            <button className="page-btn">2</button>
            <button className="page-btn">3</button>
            <span style={{color:"var(--ink-4)", padding:"0 4px"}}>…</span>
            <button className="page-btn">26</button>
            <button className="page-btn"><I.Chevron size={12} /></button>
          </div>
          {selected.size > 0 && (
            <div style={{marginLeft:12, display:"flex", gap:6, alignItems:"center"}}>
              <span style={{color:"var(--ink)"}}><span className="num">{selected.size}</span> seleccionadas</span>
              <button className="btn btn-secondary" style={{padding:"4px 8px"}}>Enviar recordatorio</button>
              <button className="btn btn-secondary" style={{padding:"4px 8px"}}>Marcar gestión</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================== Invoice detail ===================== */

function InvoiceDetail({ invoiceId, navigate }) {
  const { Q, INVOICES, CUSTOMERS, LINES, JOURNAL_SAMPLE, formatDate } = window.MOCK;
  const [tab, setTab] = React.useState("conceptos");

  const inv = INVOICES.find(i => i.id === invoiceId) || INVOICES[0];
  const cust = CUSTOMERS.find(c => c.id === inv.custId);
  const line = LINES[inv.line];

  const today = new Date(2026, 4, 19);
  const emisionDate = new Date(today); emisionDate.setDate(emisionDate.getDate() - inv.emisionAgo);
  const dueDate = new Date(today); dueDate.setDate(dueDate.getDate() - inv.dueAgo);

  const statusBadge = {
    vencido:    { cls: "badge-wine",  text: "Vencida" },
    por_cobrar: { cls: "badge-outline", text: "Por cobrar" },
    cobrado:    { cls: "badge-olive", text: "Cobrada" },
  }[inv.status];

  // timeline progress
  const pct = inv.status === "cobrado" ? 100 : inv.status === "vencido" ? 66 : 66;

  // conceptos sample
  const subtotal = Math.round(inv.total / 1.12);
  const iva = inv.total - subtotal;

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div>
          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:6}}>
            <button className="btn btn-ghost" style={{padding:"3px 8px"}} onClick={() => navigate("invoices")}>
              <I.ChevLeft size={13} /> Volver a Facturación
            </button>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:12}}>
            <h1 className="page-title" style={{fontSize:26}}><span className="num" style={{letterSpacing:"-0.01em"}}>{inv.id}</span></h1>
            <span className={"badge " + statusBadge.cls} style={{fontSize:11.5, padding:"3px 10px"}}>{statusBadge.text}</span>
            <span style={{display:"inline-flex", alignItems:"center", gap:6, fontSize:12, color:"var(--ink-3)"}}>
              <span className={"dot " + line.dot}></span>{line.name}
            </span>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Print size={13} /></button>
          <button className="btn btn-secondary"><I.Mail size={13} /> Reenviar</button>
          <button className="btn btn-secondary"><I.Download size={13} /> Descargar PDF</button>
          <button className="btn btn-secondary"><I.Coins size={13} /> Registrar cobro</button>
          <button className="btn btn-ghost"><I.More size={14} /></button>
        </div>
      </div>

      {/* 4 stats */}
      <div className="kpi-grid" style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr", marginBottom:22}}>
        <div className="kpi">
          <div className="kpi-label">Cliente</div>
          <div style={{fontSize:14, fontWeight:500, marginTop:2, marginBottom:4, color:"var(--ink)"}}>
            <button onClick={() => navigate("customer", { customerId: cust.id })} style={{textAlign:"left", color:"inherit"}}>{cust.short}</button>
          </div>
          <div style={{fontSize:11.5, color:"var(--ink-3)"}}>NIT <span className="num">{cust.nit}</span> · {cust.contact}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total facturado</div>
          <div className="kpi-value"><span className="currency">Q</span>{inv.total.toLocaleString("en-US")}</div>
          <div className="kpi-delta"><span className="vs">IVA incluido · 12%</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Saldo pendiente</div>
          <div className="kpi-value" style={{color: inv.balance > 0 ? "var(--wine)" : "var(--olive)"}}>
            <span className="currency">Q</span>{inv.balance.toLocaleString("en-US")}
          </div>
          <div className="kpi-delta"><span className="vs">{inv.balance === 0 ? "Pagada completa" : `${Math.round((1 - inv.balance/inv.total)*100)}% cobrado`}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Vencimiento</div>
          <div className="kpi-value" style={{fontSize:18}}>{formatDate(dueDate)}</div>
          <div className="kpi-delta" style={{color: inv.dueAgo > 0 ? "var(--wine)" : "var(--ink-3)"}}>
            <I.Clock size={11} /> {inv.dueAgo > 0 ? `Vencida hace ${inv.dueAgo} días` : `Vence en ${Math.abs(inv.dueAgo)} días`}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="card" style={{marginBottom:22}}>
        <div className="card-pad">
          <Timeline status={inv.status} dates={{ emision: emisionDate, vencimiento: dueDate }} pct={pct} />
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={"tab" + (tab === "conceptos" ? " active" : "")} onClick={() => setTab("conceptos")}>Conceptos</button>
        <button className={"tab" + (tab === "cobros" ? " active" : "")} onClick={() => setTab("cobros")}>
          Cobros aplicados <span className="tab-count num">{inv.status === "cobrado" ? 1 : 0}</span>
        </button>
        <button className={"tab" + (tab === "asiento" ? " active" : "")} onClick={() => setTab("asiento")}>Asiento contable</button>
        <button className={"tab" + (tab === "historial" ? " active" : "")} onClick={() => setTab("historial")}>Historial</button>
        <button className={"tab" + (tab === "adjuntos" ? " active" : "")} onClick={() => setTab("adjuntos")}>Adjuntos <span className="tab-count num">2</span></button>
      </div>

      {tab === "conceptos" && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th style={{width: 60}}>#</th>
                <th>Descripción</th>
                <th>Centro</th>
                <th className="num">Cantidad</th>
                <th className="num">P. unitario</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num cell-mute">1</td>
                <td className="cell-strong">Estudio {line.name.toLowerCase()} — paquete corporativo Q2 '26</td>
                <td><span style={{display:"inline-flex", alignItems:"center", gap:6}}><span className={"dot " + line.dot}></span>{line.name}</span></td>
                <td className="num">12</td>
                <td className="num">{Q(Math.round(subtotal * 0.7 / 12))}</td>
                <td className="num cell-strong">{Q(Math.round(subtotal * 0.7))}</td>
              </tr>
              <tr>
                <td className="num cell-mute">2</td>
                <td className="cell-strong">Honorarios profesionales — entregables anexos</td>
                <td><span style={{display:"inline-flex", alignItems:"center", gap:6}}><span className={"dot " + line.dot}></span>{line.name}</span></td>
                <td className="num">1</td>
                <td className="num">{Q(Math.round(subtotal * 0.3))}</td>
                <td className="num cell-strong">{Q(Math.round(subtotal * 0.3))}</td>
              </tr>
              <tr style={{background:"var(--bg-2)"}}>
                <td colSpan="5" className="num" style={{textAlign:"right", color:"var(--ink-3)"}}>Subtotal</td>
                <td className="num cell-strong">{Q(subtotal)}</td>
              </tr>
              <tr style={{background:"var(--bg-2)"}}>
                <td colSpan="5" className="num" style={{textAlign:"right", color:"var(--ink-3)"}}>IVA (12%)</td>
                <td className="num cell-strong">{Q(iva)}</td>
              </tr>
              <tr style={{background:"var(--bg-2)"}}>
                <td colSpan="5" className="num" style={{textAlign:"right", color:"var(--ink)", fontSize:13, fontWeight:600}}>Total</td>
                <td className="num" style={{fontSize:14, fontWeight:600, color:"var(--ink)"}}>{Q(inv.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === "asiento" && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Asiento contable</div>
            <span className="badge badge-mute">Diario · folio 2026-{Math.floor(Math.random()*900)+100}</span>
            <div className="card-actions" style={{fontSize:11, color:"var(--ink-3)"}}>{formatDate(emisionDate)}</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Centro</th>
                <th className="num">Debe</th>
                <th className="num">Haber</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell-strong"><span className="num" style={{color:"var(--ink-4)"}}>1101.02</span> &nbsp; Clientes por cobrar</td>
                <td>{line.name}</td>
                <td className="num cell-strong">{Q(inv.total)}</td>
                <td className="num cell-mute">—</td>
              </tr>
              <tr>
                <td className="cell-strong"><span className="num" style={{color:"var(--ink-4)"}}>4101.01</span> &nbsp; Ingresos por servicios</td>
                <td>{line.name}</td>
                <td className="num cell-mute">—</td>
                <td className="num cell-strong">{Q(subtotal)}</td>
              </tr>
              <tr>
                <td className="cell-strong"><span className="num" style={{color:"var(--ink-4)"}}>2102.01</span> &nbsp; IVA por pagar</td>
                <td className="cell-mute">—</td>
                <td className="num cell-mute">—</td>
                <td className="num cell-strong">{Q(iva)}</td>
              </tr>
              <tr style={{background:"var(--bg-2)"}}>
                <td colSpan="2" className="num" style={{textAlign:"right", fontSize:11, color:"var(--ink-3)"}}>TOTAL PARTIDA</td>
                <td className="num" style={{fontWeight:600}}>{Q(inv.total)}</td>
                <td className="num" style={{fontWeight:600}}>{Q(inv.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === "cobros" && (
        inv.status === "cobrado" ? (
          <div className="card">
            <table className="table">
              <thead><tr><th>Recibo</th><th>Fecha</th><th>Banco</th><th>Método</th><th className="num">Monto</th></tr></thead>
              <tbody>
                <tr>
                  <td className="num cell-strong">REC-2026-0188</td>
                  <td className="num">{formatDate(new Date(emisionDate.getTime() + 30*86400000))}</td>
                  <td>BAC · Cuenta operativa</td>
                  <td>Transferencia</td>
                  <td className="num cell-strong">{Q(inv.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-pad" style={{textAlign:"center", padding:"60px 20px", color:"var(--ink-4)"}}>
            <I.Coins size={28} style={{opacity:0.4, marginBottom:10}} />
            <div className="serif" style={{fontSize:16, color:"var(--ink-2)", marginBottom:6}}>Sin cobros aplicados</div>
            <div style={{fontSize:12, marginBottom:14}}>Esta factura aún no ha recibido pagos.</div>
            <button className="btn btn-primary"><I.Plus size={13} /> Registrar primer cobro</button>
          </div>
        )
      )}

      {tab === "historial" && (
        <div className="card">
          <div style={{padding:"6px 0"}}>
            {[
              { d: "hace 2 días", icon:"Mail",   t: "Recordatorio enviado", s: "Stark Méndez envió correo de cobro a "+cust.contact },
              { d: "hace 8 días", icon:"Clock",  t: "Factura vencida",      s: "El sistema marcó la factura como vencida (cruzó 30 d sin pago)" },
              { d: "hace 15 días",icon:"Mail",   t: "Primer aviso",         s: "Correo automático enviado al cliente con saldo de "+window.MOCK.Q(inv.balance) },
              { d: formatDate(emisionDate), icon:"Receipt", t: "Factura emitida", s: "Estado: pendiente · Centro de costo: "+line.name },
            ].map((e, i) => {
              const Ico = I[e.icon];
              return (
                <div key={i} style={{display:"flex", gap:14, padding:"14px 24px", borderBottom: "1px solid var(--line-3)"}}>
                  <div style={{width:30, height:30, borderRadius:6, background:"var(--bg-2)", color:"var(--ink-3)", display:"grid", placeItems:"center", flexShrink:0}}>
                    <Ico size={14} />
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12.5, fontWeight:500, color:"var(--ink)"}}>{e.t}</div>
                    <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>{e.s}</div>
                  </div>
                  <div style={{fontSize:11, color:"var(--ink-4)", whiteSpace:"nowrap"}}>{e.d}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "adjuntos" && (
        <div className="card card-pad">
          <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12}}>
            {["Orden de compra OC-3318.pdf", "Contrato marco firmado.pdf"].map((f, i) => (
              <div key={i} style={{padding:14, border:"1px solid var(--line)", borderRadius:"var(--r-2)", display:"flex", gap:10, alignItems:"center", background:"var(--paper-2)"}}>
                <div style={{width:32, height:40, background:"var(--bg-2)", borderRadius:3, display:"grid", placeItems:"center", color:"var(--ink-3)", fontSize:9, fontFamily:"var(--mono)", fontWeight:600}}>PDF</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{f}</div>
                  <div style={{fontSize:10.5, color:"var(--ink-4)"}} className="num">{(180 + i*40) + " KB"} · {formatDate(emisionDate)}</div>
                </div>
                <button className="modal-close"><I.Download size={13} /></button>
              </div>
            ))}
            <button style={{padding:14, border:"1px dashed var(--line-2)", borderRadius:"var(--r-2)", color:"var(--ink-3)", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:"transparent"}}>
              <I.Paperclip size={13} /> Adjuntar archivo
            </button>
          </div>
        </div>
      )}

      {/* AI tip footer */}
      <div className="card" style={{marginTop:22, background:"var(--paper)", borderColor:"var(--line-2)"}}>
        <div style={{padding:"14px 20px", display:"flex", gap:14, alignItems:"flex-start"}}>
          <div className="ai-avatar" style={{width:24, height:24, flexShrink:0, marginTop:2}}></div>
          <div style={{flex:1, fontSize:12.5, lineHeight:1.55, color:"var(--ink-2)"}}>
            <strong style={{color:"var(--ink)"}}>{cust.short}</strong> tiene <strong className="num">{INVOICES.filter(i => i.custId === cust.id && i.status === "vencido").length}</strong> facturas más vencidas por <strong className="num">{Q(cust.vencido)}</strong>. Paga en promedio a los <strong className="num">{cust.avgPayDays} días</strong>. <em className="serif" style={{fontStyle:"italic"}}>Sugerencia:</em> consolidar gestión en una sola llamada antes del cierre.
          </div>
          <button className="ai-action-btn primary">Ver cuenta corriente</button>
        </div>
      </div>
    </div>
  );
}

/* ===================== Timeline ===================== */

function Timeline({ status, dates, pct }) {
  const steps = [
    { label: "Emitida",      date: window.MOCK.formatDate(dates.emision),       done: true },
    { label: "Contabilizada", date: window.MOCK.formatDate(dates.emision),       done: true },
    { label: status === "cobrado" ? "Cobrada" : "Vence", date: window.MOCK.formatDate(dates.vencimiento), done: status === "cobrado" },
  ];

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", marginBottom:8}}>
        <span style={{fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500}}>Ciclo de la factura</span>
        <span style={{marginLeft:"auto", fontSize:11.5, color:"var(--ink-3)"}} className="num">{pct}% completado</span>
      </div>
      <div style={{position:"relative", display:"flex", justifyContent:"space-between", padding:"4px 16px 0"}}>
        <div style={{position:"absolute", top:18, left:32, right:32, height:2, background:"var(--bg-2)", borderRadius:1}}></div>
        <div style={{position:"absolute", top:18, left:32, width:`calc((100% - 64px) * ${pct/100})`, height:2, background: status === "cobrado" ? "var(--olive)" : "var(--amber)", borderRadius:1, transition:"width 0.4s"}}></div>
        {steps.map((s, i) => (
          <div key={i} style={{position:"relative", textAlign:"center", flex:"0 0 auto", zIndex:2, background:"var(--paper)", padding:"0 8px"}}>
            <div style={{width:28, height:28, borderRadius:"50%", border:"2px solid " + (s.done ? "var(--olive)" : "var(--line-2)"), background: s.done ? "var(--olive)" : "var(--paper)", color: s.done ? "var(--paper)" : "var(--ink-4)", display:"grid", placeItems:"center", margin:"0 auto"}}>
              {s.done ? <I.Check size={14} /> : <span style={{fontSize:10, fontFamily:"var(--mono)", fontWeight:600}}>{i+1}</span>}
            </div>
            <div style={{fontSize:11.5, fontWeight:500, color:"var(--ink)", marginTop:6}}>{s.label}</div>
            <div style={{fontSize:10.5, color:"var(--ink-4)", marginTop:1}} className="num">{s.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.InvoicesList = InvoicesList;
window.InvoiceDetail = InvoiceDetail;
