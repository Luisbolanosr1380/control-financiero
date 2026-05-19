/* ===================== Nueva factura (modal) ===================== */

function InvoiceNew({ onClose }) {
  const { Q, CUSTOMERS, LINES, formatDate } = window.MOCK;

  const [customerId, setCustomerId] = React.useState("C-002");
  const [lineKey, setLineKey] = React.useState("socio");
  const [credit, setCredit] = React.useState(30);
  const [items, setItems] = React.useState([
    { desc: "Estudio socioeconómico — paquete corporativo Q2 '26", qty: 12, price: 7800 },
    { desc: "Honorarios profesionales — entregables anexos",        qty: 1,  price: 18400 },
  ]);
  const [notes, setNotes] = React.useState("Pago contra entrega de informe final. Crédito acordado por contrato 2026-CM-0045.");

  const cust = CUSTOMERS.find(c => c.id === customerId) || CUSTOMERS[0];
  const line = LINES[lineKey];
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const iva = Math.round(subtotal * 0.12);
  const total = subtotal + iva;

  const today = new Date(2026, 4, 19);
  const due = new Date(today); due.setDate(due.getDate() + credit);

  const updateItem = (i, field, val) => {
    const copy = [...items];
    copy[i] = { ...copy[i], [field]: val };
    setItems(copy);
  };

  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="modal">
        <div className="modal-card">
          <div className="modal-head">
            <div>
              <div className="modal-title">Nueva factura</div>
              <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>Borrador F-2026-0724 · iniciado hace 1 minuto</div>
            </div>
            <div style={{marginLeft:"auto", display:"flex", gap:6, alignItems:"center"}}>
              <span className="badge badge-mute">Borrador · auto-guardado</span>
              <button className="modal-close" onClick={onClose}><I.X size={16} /></button>
            </div>
          </div>

          <div className="modal-body" style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:0}}>
            {/* ===== Form ===== */}
            <div style={{padding:"22px 26px", borderRight:"1px solid var(--line-3)"}}>
              <div className="field">
                <label className="label">Cliente</label>
                <div className="input" style={{display:"flex", alignItems:"center", gap:8, padding:"4px 10px", height:38}}>
                  <I.Building size={14} style={{color:"var(--ink-3)"}}/>
                  <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                    style={{flex:1, background:"transparent", border:"none", fontSize:13, color:"var(--ink)"}}>
                    {CUSTOMERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11}}>
                    <I.Plus size={11}/> Nuevo cliente
                  </button>
                </div>
                <div style={{fontSize:11, color:"var(--ink-4)", marginTop:4}}>
                  NIT <span className="num">{cust.nit}</span> · Saldo actual <span className="num">{Q(cust.totalBalance)}</span> · Crédito histórico {cust.credit} días
                </div>
              </div>

              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
                <div className="field">
                  <label className="label">Fecha de emisión</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:8}}>
                    <I.Calendar size={13} style={{color:"var(--ink-3)"}}/>
                    <span style={{flex:1}}>{formatDate(today)}</span>
                  </div>
                </div>
                <div className="field">
                  <label className="label">Días de crédito</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:8}}>
                    <select value={credit} onChange={e => setCredit(+e.target.value)} style={{flex:1, background:"transparent", border:"none", fontSize:13}}>
                      <option value="0">Contado</option>
                      <option value="15">15 días</option>
                      <option value="30">30 días</option>
                      <option value="45">45 días</option>
                      <option value="60">60 días</option>
                    </select>
                    <span style={{fontSize:11, color:"var(--ink-4)"}}>Vence {formatDate(due)}</span>
                  </div>
                </div>
              </div>

              <div className="field">
                <label className="label">Centro de costo</label>
                <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6}}>
                  {Object.values(LINES).map(l => (
                    <button key={l.key} onClick={() => setLineKey(l.key)}
                      style={{
                        padding:"8px 10px", border: lineKey === l.key ? "1px solid var(--ink)" : "1px solid var(--line)",
                        background: lineKey === l.key ? "var(--paper-2)" : "transparent",
                        borderRadius:"var(--r-2)", display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--ink)",
                        cursor:"pointer"
                      }}>
                      <span className={"dot " + l.dot}></span>{l.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider"></div>

              <div className="label" style={{marginBottom:8, display:"flex", alignItems:"center"}}>
                Líneas de factura
                <button className="btn btn-ghost" style={{marginLeft:"auto", padding:"3px 8px", fontSize:11}}
                        onClick={() => setItems([...items, { desc: "", qty: 1, price: 0 }])}>
                  <I.Plus size={11}/> Agregar línea
                </button>
              </div>

              <table className="table" style={{fontSize:12, background:"var(--paper-2)", border:"1px solid var(--line)", borderRadius:"var(--r-2)", overflow:"hidden"}}>
                <thead>
                  <tr>
                    <th style={{width:"55%"}}>Descripción</th>
                    <th className="num" style={{width:50}}>Cant</th>
                    <th className="num" style={{width:100}}>Precio</th>
                    <th className="num">Total</th>
                    <th style={{width:30}}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        <input value={it.desc} onChange={e => updateItem(i, "desc", e.target.value)}
                          style={{width:"100%", background:"transparent", border:"none", fontSize:12, color:"var(--ink)"}}/>
                      </td>
                      <td className="num">
                        <input type="number" value={it.qty} onChange={e => updateItem(i, "qty", +e.target.value)}
                          style={{width:50, background:"transparent", border:"none", fontSize:12, textAlign:"right", color:"var(--ink)", fontFamily:"var(--mono)"}}/>
                      </td>
                      <td className="num">
                        <input type="number" value={it.price} onChange={e => updateItem(i, "price", +e.target.value)}
                          style={{width:90, background:"transparent", border:"none", fontSize:12, textAlign:"right", color:"var(--ink)", fontFamily:"var(--mono)"}}/>
                      </td>
                      <td className="num cell-strong">{Q(it.qty * it.price)}</td>
                      <td>
                        <button className="modal-close" onClick={() => setItems(items.filter((_,j) => j !== i))}>
                          <I.X size={12}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="field" style={{marginTop:18}}>
                <label className="label">Observaciones</label>
                <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} rows="3"></textarea>
              </div>
            </div>

            {/* ===== Preview ===== */}
            <div style={{padding:"22px 26px", background:"var(--bg-2)"}}>
              <div style={{fontSize:10.5, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:10}}>
                Vista previa de la factura
              </div>
              <div style={{background:"var(--paper-2)", border:"1px solid var(--line)", borderRadius:"var(--r-3)", padding:28, boxShadow:"var(--shadow-1)"}}>
                <div style={{display:"flex", alignItems:"flex-start", marginBottom:24}}>
                  <div>
                    <div className="brand-mark" style={{width:34, height:34, fontSize:16}}>CF</div>
                    <div className="serif" style={{fontSize:16, marginTop:8, color:"var(--ink)"}}>Control Financiero, S.A.</div>
                    <div style={{fontSize:10.5, color:"var(--ink-4)", marginTop:2, lineHeight:1.5}}>NIT 8472193-K<br/>9a. Avenida 14-23 zona 10, Guatemala</div>
                  </div>
                  <div style={{marginLeft:"auto", textAlign:"right"}}>
                    <div style={{fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500}}>Factura</div>
                    <div className="serif num" style={{fontSize:22, color:"var(--ink)", letterSpacing:"-0.01em"}}>F-2026-0724</div>
                    <div style={{fontSize:10.5, color:"var(--ink-4)", marginTop:6}}>
                      Emisión <span className="num" style={{color:"var(--ink-2)"}}>{formatDate(today)}</span><br/>
                      Vencimiento <span className="num" style={{color:"var(--ink-2)"}}>{formatDate(due)}</span>
                    </div>
                  </div>
                </div>

                <div style={{padding:"10px 0", borderTop:"1px solid var(--line-3)", borderBottom:"1px solid var(--line-3)", marginBottom:14}}>
                  <div style={{fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:4}}>Facturar a</div>
                  <div style={{fontSize:12, fontWeight:500, color:"var(--ink)"}}>{cust.name}</div>
                  <div style={{fontSize:10.5, color:"var(--ink-3)", marginTop:2}}>NIT <span className="num">{cust.nit}</span> · {cust.contact}</div>
                </div>

                <table style={{width:"100%", fontSize:11, borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{color:"var(--ink-4)", textTransform:"uppercase", fontSize:9.5, letterSpacing:"0.06em"}}>
                      <th style={{textAlign:"left", padding:"6px 0", fontWeight:500}}>Concepto</th>
                      <th style={{textAlign:"right", padding:"6px 0", fontWeight:500}}>Cant</th>
                      <th style={{textAlign:"right", padding:"6px 0", fontWeight:500}}>Unitario</th>
                      <th style={{textAlign:"right", padding:"6px 0", fontWeight:500}}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} style={{borderBottom:"1px solid var(--line-3)"}}>
                        <td style={{padding:"8px 0", color:"var(--ink-2)"}}>{it.desc || <span style={{color:"var(--ink-4)"}}>—</span>}</td>
                        <td style={{padding:"8px 0", textAlign:"right", fontFamily:"var(--mono)"}}>{it.qty}</td>
                        <td style={{padding:"8px 0", textAlign:"right", fontFamily:"var(--mono)"}}>{Q(it.price)}</td>
                        <td style={{padding:"8px 0", textAlign:"right", fontFamily:"var(--mono)", color:"var(--ink)"}}>{Q(it.qty * it.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{marginTop:14, marginLeft:"auto", width:240}}>
                  <div style={{display:"flex", justifyContent:"space-between", fontSize:11, padding:"4px 0", color:"var(--ink-3)"}}>
                    <span>Subtotal</span><span className="num">{Q(subtotal)}</span>
                  </div>
                  <div style={{display:"flex", justifyContent:"space-between", fontSize:11, padding:"4px 0", color:"var(--ink-3)"}}>
                    <span>IVA · 12%</span><span className="num">{Q(iva)}</span>
                  </div>
                  <div style={{display:"flex", justifyContent:"space-between", padding:"8px 0", marginTop:4, borderTop:"1px solid var(--line)", color:"var(--ink)"}}>
                    <span style={{fontSize:11, fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase"}}>Total</span>
                    <span className="num serif" style={{fontSize:18, fontWeight:500}}>{Q(total)}</span>
                  </div>
                </div>

                {notes && (
                  <div style={{marginTop:24, padding:"10px 12px", background:"var(--bg)", borderRadius:"var(--r-2)", fontSize:10.5, color:"var(--ink-3)", lineHeight:1.5, fontStyle:"italic"}}>
                    {notes}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <span style={{fontSize:11.5, color:"var(--ink-3)"}}>
              <I.Info size={11} style={{verticalAlign:"-1px", marginRight:4}}/>
              Al emitir, se generará automáticamente el asiento contable de venta.
            </span>
            <div className="spacer"></div>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-secondary">Guardar borrador</button>
            <button className="btn btn-primary" onClick={onClose}>Emitir factura · {Q(total)}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== Cuenta corriente de cliente ===================== */

function CustomerDetail({ customerId, navigate }) {
  const { Q, CUSTOMERS, INVOICES, LINES, formatDateShort, formatDate } = window.MOCK;
  const cust = CUSTOMERS.find(c => c.id === customerId) || CUSTOMERS[0];
  const [tab, setTab] = React.useState("facturas");

  const custInvoices = INVOICES.filter(i => i.custId === cust.id);
  const today = new Date(2026, 4, 19);

  // synthetic 12-month balance evolution
  const balanceTrend = Array.from({length:12}, (_,i) => {
    const base = cust.totalBalance * (0.3 + (i / 11) * 0.7);
    return { m: ["Jun","Jul","Ago","Sep","Oct","Nov","Dic","Ene","Feb","Mar","Abr","May"][i], v: Math.round(base * (0.85 + Math.random() * 0.3)) };
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:6}}>
            <button className="btn btn-ghost" style={{padding:"3px 8px"}} onClick={() => navigate("customers")}>
              <I.ChevLeft size={13}/> Clientes
            </button>
          </div>
          <h1 className="page-title">{cust.short}</h1>
          <div className="page-subtitle">
            NIT <span className="num">{cust.nit}</span> · {cust.credit} días crédito · {cust.contact} · <span className="num">{cust.phone}</span>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Mail size={13}/> Enviar correo</button>
          <button className="btn btn-secondary"><I.Download size={13}/> Estado de cuenta PDF</button>
          <button className="btn btn-primary"><I.Coins size={13}/> Registrar cobro</button>
        </div>
      </div>

      {/* Header stats */}
      <div className="kpi-grid" style={{gridTemplateColumns:"repeat(5, 1fr)", marginBottom:22}}>
        <div className="kpi">
          <div className="kpi-label">Saldo total</div>
          <div className="kpi-value"><span className="currency">Q</span>{cust.totalBalance.toLocaleString("en-US")}</div>
          <div className="kpi-delta neg"><I.ArrowUp size={11}/> 12.4% <span className="vs">últimos 30d</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Saldo vencido</div>
          <div className="kpi-value" style={{color:"var(--wine)"}}><span className="currency">Q</span>{cust.vencido.toLocaleString("en-US")}</div>
          <div className="kpi-delta neg"><span className="vs">{Math.round(cust.vencido/cust.totalBalance*100)}% del total</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Días promedio pago</div>
          <div className="kpi-value"><span className="num">{cust.avgPayDays}</span><span style={{fontSize:13, color:"var(--ink-3)", marginLeft:4}}>días</span></div>
          <div className="kpi-delta neg"><span className="vs">vs {cust.credit} acordados</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Facturas activas</div>
          <div className="kpi-value"><span className="num">{custInvoices.length}</span></div>
          <div className="kpi-delta"><span className="vs">{custInvoices.filter(i=>i.status==="vencido").length} vencidas</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pagos a tiempo</div>
          <div className="kpi-value"><span className="num">{Math.round(cust.onTimeRate * 100)}%</span></div>
          <div className="kpi-delta"><span className="vs">últimas {Math.round(1/cust.onTimeRate * cust.onTimeRate * 8) || 8} facturas</span></div>
        </div>
      </div>

      {/* AI insight */}
      <div className="card" style={{marginBottom:22, background:"var(--paper)", borderColor:"var(--line-2)"}}>
        <div style={{padding:"16px 22px", display:"flex", gap:14, alignItems:"flex-start"}}>
          <div className="ai-avatar" style={{width:26, height:26, flexShrink:0, marginTop:2}}></div>
          <div style={{flex:1, fontSize:13, lineHeight:1.55, color:"var(--ink-2)"}}>
            <div style={{fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:4}}>Perfil de pago</div>
            Este cliente paga en promedio a los <strong className="num">{cust.avgPayDays} días</strong>, pero acordó <strong className="num">{cust.credit} días</strong> en contrato. Pagó <em className="serif" style={{fontStyle:"italic"}}>puntual</em> {Math.round(cust.onTimeRate * 8)} de las últimas 8 veces. {cust.avgPayDays > 50 ? "Riesgo creciente: el delay aumentó 14 días desde Q1." : "Pago consistente."}
          </div>
          <button className="ai-action-btn primary">Plan de gestión</button>
        </div>
      </div>

      {/* Two columns: trend + aging */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 380px", gap:20, marginBottom:22}}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Evolución del saldo · 12 meses</div>
            <div className="card-actions" style={{fontSize:11, color:"var(--ink-4)"}}>El saldo creció {Math.round(((balanceTrend[11].v - balanceTrend[0].v) / balanceTrend[0].v) * 100)}% en 12 meses</div>
          </div>
          <div className="card-pad">
            <BalanceTrend data={balanceTrend} />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Aging del cliente</div></div>
          <div className="card-pad">
            <div style={{display:"flex", height:34, borderRadius:5, overflow:"hidden", border:"1px solid var(--line)"}}>
              <div className="aging-seg aging-current" style={{flex: cust.totalBalance - cust.vencido}}>{Math.round((cust.totalBalance-cust.vencido)/cust.totalBalance*100)}%</div>
              <div className="aging-seg aging-31-60" style={{flex: cust.vencido * 0.2}}></div>
              <div className="aging-seg aging-61-90" style={{flex: cust.vencido * 0.3}}></div>
              <div className="aging-seg aging-90" style={{flex: cust.vencido * 0.5}}>{Math.round(cust.vencido*0.5/cust.totalBalance*100)}%</div>
            </div>
            <div style={{marginTop:14}}>
              {[
                { lbl:"Corriente", v: cust.totalBalance - cust.vencido, c:"var(--ink-2)" },
                { lbl:"31–60 días", v: Math.round(cust.vencido * 0.2), c:"var(--amber)" },
                { lbl:"61–90 días", v: Math.round(cust.vencido * 0.3), c:"var(--amber)" },
                { lbl:"+90 días",   v: Math.round(cust.vencido * 0.5), c:"var(--wine)" },
              ].map((r, i) => (
                <div key={i} style={{display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:12, borderBottom: i < 3 ? "1px solid var(--line-3)" : "none"}}>
                  <span style={{color:"var(--ink-3)"}}>{r.lbl}</span>
                  <span className="num" style={{color: r.c, fontWeight: 500}}>{Q(r.v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={"tab" + (tab === "facturas" ? " active" : "")} onClick={() => setTab("facturas")}>
          Facturas <span className="tab-count num">{custInvoices.length}</span>
        </button>
        <button className={"tab" + (tab === "cobros" ? " active" : "")} onClick={() => setTab("cobros")}>
          Cobros <span className="tab-count num">{custInvoices.filter(i=>i.status==="cobrado").length}</span>
        </button>
        <button className={"tab" + (tab === "asientos" ? " active" : "")} onClick={() => setTab("asientos")}>
          Asientos <span className="tab-count num">{custInvoices.length * 2}</span>
        </button>
        <button className={"tab" + (tab === "gestiones" ? " active" : "")} onClick={() => setTab("gestiones")}>Gestiones</button>
      </div>

      {tab === "facturas" && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Factura</th><th>Centro</th><th>Emisión</th><th>Vencimiento</th>
                <th className="num">Total</th><th className="num">Saldo</th>
                <th>Estado</th><th>Aging</th>
              </tr>
            </thead>
            <tbody>
              {custInvoices.map(inv => {
                const line = LINES[inv.line];
                const em = new Date(today); em.setDate(em.getDate() - inv.emisionAgo);
                const du = new Date(today); du.setDate(du.getDate() - inv.dueAgo);
                const stat = {
                  vencido: { cls:"badge-wine", text:"Vencida" },
                  por_cobrar: { cls:"badge-outline", text:"Por cobrar" },
                  cobrado: { cls:"badge-olive", text:"Cobrada" },
                }[inv.status];
                const ag = inv.status === "cobrado" ? { cls:"badge-olive", text:"—" }
                  : inv.dueAgo > 60 ? { cls:"badge-wine", text:`${inv.dueAgo}d` }
                  : inv.dueAgo > 0 ? { cls:"badge-warn", text:`${inv.dueAgo}d` }
                  : { cls:"badge-mute", text:`${Math.abs(inv.dueAgo)}d` };
                return (
                  <tr key={inv.id} className="clickable" onClick={() => navigate("invoice-detail", { invoiceId: inv.id })}>
                    <td className="num cell-strong">{inv.id}</td>
                    <td><span style={{display:"inline-flex", alignItems:"center", gap:6}}><span className={"dot " + line.dot}></span>{line.name}</span></td>
                    <td className="num cell-mute">{formatDateShort(em)}</td>
                    <td className="num">{formatDateShort(du)}</td>
                    <td className="num cell-strong">{Q(inv.total)}</td>
                    <td className="num cell-strong">{Q(inv.balance)}</td>
                    <td><span className={"badge " + stat.cls}>{stat.text}</span></td>
                    <td><span className={"badge " + ag.cls}>{ag.text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab !== "facturas" && (
        <div className="card card-pad" style={{padding:60, textAlign:"center", color:"var(--ink-4)"}}>
          <div className="serif" style={{fontSize:16, color:"var(--ink-2)", marginBottom:6}}>Sección {tab}</div>
          <div style={{fontSize:12}}>Vista en construcción.</div>
        </div>
      )}
    </div>
  );
}

/* ===================== Balance trend chart ===================== */

function BalanceTrend({ data }) {
  const W = 720, H = 200, P = { l: 40, r: 12, t: 10, b: 22 };
  const max = Math.max(...data.map(d => d.v)) * 1.1;
  const min = Math.min(...data.map(d => d.v)) * 0.7;
  const xs = (i) => P.l + ((W - P.l - P.r) * i) / (data.length - 1);
  const ys = (v) => H - P.b - ((H - P.t - P.b) * (v - min)) / (max - min);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(d.v)}`).join(" ");
  const area = path + ` L ${xs(data.length-1)} ${H-P.b} L ${xs(0)} ${H-P.b} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%", height: 200, display:"block"}}>
      <defs>
        <linearGradient id="balArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--wine)" stopOpacity="0.16"/>
          <stop offset="100%" stopColor="var(--wine)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t,i) => (
        <line key={i} x1={P.l} x2={W-P.r} y1={ys(min + (max-min)*t)} y2={ys(min + (max-min)*t)} stroke="var(--line-3)" strokeDasharray={i === 0 ? "0" : "2 4"} />
      ))}
      <path d={area} fill="url(#balArea)" />
      <path d={path} fill="none" stroke="var(--wine)" strokeWidth="1.75" />
      {data.map((d, i) => (
        <g key={i}>
          <text x={xs(i)} y={H - 6} fontSize="9" fill="var(--ink-4)" textAnchor="middle">{d.m}</text>
          {i === data.length - 1 && (
            <>
              <circle cx={xs(i)} cy={ys(d.v)} r="3.5" fill="var(--wine)" stroke="var(--paper)" strokeWidth="2"/>
              <text x={xs(i) - 8} y={ys(d.v) - 8} fontSize="10" fill="var(--ink)" textAnchor="end" fontFamily="var(--mono)" fontWeight="600">{window.MOCK.Q(d.v)}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

window.InvoiceNew = InvoiceNew;
window.CustomerDetail = CustomerDetail;
