/* ===================== Customer list (Clientes) ===================== */

function CustomersList({ navigate }) {
  const { Q, CUSTOMERS } = window.MOCK;
  const [search, setSearch] = React.useState("");

  const rows = CUSTOMERS.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <div className="page-subtitle"><span className="num">{CUSTOMERS.length}</span> cuentas activas · <span className="num">Q1,614,094</span> saldo total</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13}/> Exportar</button>
          <button className="btn btn-primary"><I.Plus size={13}/> Nuevo cliente</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{color:"var(--ink-4)"}} />
          <input placeholder="Cliente, NIT, contacto…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="filter-chip active">Con saldo</button>
        <button className="filter-chip">Vencidos</button>
        <button className="filter-chip">Industria</button>
        <div style={{marginLeft:"auto", fontSize:11.5, color:"var(--ink-3)"}}>
          Ordenar: <span style={{color:"var(--ink)"}}>Saldo total ↓</span>
        </div>
      </div>

      <div className="table-wrap" style={{borderRadius:"0 0 var(--r-3) var(--r-3)", borderTop:"none"}}>
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Contacto</th>
              <th className="num">Crédito</th>
              <th className="num">Saldo total</th>
              <th className="num">Vencido</th>
              <th className="num">Días prom. pago</th>
              <th>Cumplimiento</th>
              <th>Última gestión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id} className="clickable" onClick={() => navigate("customer", { customerId: c.id })}>
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:10}}>
                    <div style={{width:28, height:28, borderRadius:"var(--r-2)", background:"var(--bg-2)", color:"var(--ink-2)", display:"grid", placeItems:"center", fontFamily:"var(--serif)", fontSize:12, fontWeight:500}}>
                      {c.short.split(" ").slice(0,2).map(w => w[0]).join("").toUpperCase()}
                    </div>
                    <div>
                      <div className="cell-strong">{c.short}</div>
                      <div className="cell-mute" style={{fontSize:11}}>NIT <span className="num">{c.nit}</span></div>
                    </div>
                  </div>
                </td>
                <td>
                  <div>{c.contact}</div>
                  <div className="cell-mute" style={{fontSize:11}}>{c.email}</div>
                </td>
                <td className="num">{c.credit}d</td>
                <td className="num cell-strong">{Q(c.totalBalance)}</td>
                <td className="num" style={{color: c.vencido > 0 ? "var(--wine)" : "var(--ink-3)"}}>{Q(c.vencido)}</td>
                <td className="num">{c.avgPayDays}d</td>
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:6}}>
                    <div style={{width:60, height:4, background:"var(--bg-2)", borderRadius:2, overflow:"hidden"}}>
                      <div style={{height:"100%", width:`${c.onTimeRate*100}%`, background: c.onTimeRate > 0.7 ? "var(--olive)" : c.onTimeRate > 0.4 ? "var(--amber)" : "var(--wine)"}}></div>
                    </div>
                    <span className="num" style={{fontSize:11, color:"var(--ink-3)"}}>{Math.round(c.onTimeRate*100)}%</span>
                  </div>
                </td>
                <td className="cell-mute" style={{fontSize:11.5}}>{["hace 2d","hace 5d","hace 12d","hace 3d","ayer","hace 1d","hace 4d","hace 1w","hace 6d","hace 2w"][i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Registrar cobro (modal o pantalla) ===================== */

function PaymentRegister({ onClose, prefilledCustomer }) {
  const { Q, CUSTOMERS, INVOICES, LINES, formatDateShort } = window.MOCK;
  const [customerId, setCustomerId] = React.useState(prefilledCustomer || "C-001");
  const [amount, setAmount] = React.useState(150000);
  const [method, setMethod] = React.useState("transferencia");
  const [bank, setBank] = React.useState("BAC | Cuenta operativa Q");
  const [date, setDate] = React.useState("2026-05-19");
  const [ref, setRef] = React.useState("");
  const [selected, setSelected] = React.useState({});

  const cust = CUSTOMERS.find(c => c.id === customerId);
  const custInvs = INVOICES.filter(i => i.custId === customerId && i.balance > 0);

  // FIFO auto-distribution
  React.useEffect(() => {
    let remaining = amount;
    const newSel = {};
    const sorted = [...custInvs].sort((a, b) => b.dueAgo - a.dueAgo);
    for (const inv of sorted) {
      if (remaining <= 0) break;
      const apply = Math.min(inv.balance, remaining);
      newSel[inv.id] = apply;
      remaining -= apply;
    }
    setSelected(newSel);
  }, [amount, customerId]);

  const totalApplied = Object.values(selected).reduce((s, v) => s + (v || 0), 0);
  const unapplied = amount - totalApplied;

  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="modal">
        <div className="modal-card" style={{maxWidth:980}}>
          <div className="modal-head">
            <div>
              <div className="modal-title">Registrar cobro</div>
              <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>Aplicación automática FIFO · Override manual disponible</div>
            </div>
            <div style={{marginLeft:"auto"}}>
              <button className="modal-close" onClick={onClose}><I.X size={16}/></button>
            </div>
          </div>

          <div className="modal-body" style={{padding:0}}>
            {/* Top form row */}
            <div style={{padding:"22px 26px", borderBottom:"1px solid var(--line-3)"}}>
              <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:16}}>
                <div>
                  <label className="label">Cliente</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:8}}>
                    <I.Building size={13} style={{color:"var(--ink-3)"}}/>
                    <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{flex:1, background:"transparent", border:"none", fontSize:13}}>
                      {CUSTOMERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Monto recibido</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:6}}>
                    <span style={{color:"var(--ink-3)", fontFamily:"var(--mono)"}}>Q</span>
                    <input type="number" value={amount} onChange={e => setAmount(+e.target.value)}
                      style={{flex:1, background:"transparent", border:"none", fontSize:14, fontFamily:"var(--mono)", color:"var(--ink)", fontWeight:500}} />
                  </div>
                </div>
                <div>
                  <label className="label">Fecha</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:6}}>
                    <I.Calendar size={13} style={{color:"var(--ink-3)"}}/>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                      style={{flex:1, background:"transparent", border:"none", fontSize:13, color:"var(--ink)"}} />
                  </div>
                </div>
                <div>
                  <label className="label">Método</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:6}}>
                    <select value={method} onChange={e => setMethod(e.target.value)} style={{flex:1, background:"transparent", border:"none", fontSize:13}}>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                      <option value="deposito">Depósito en efectivo</option>
                      <option value="tarjeta">Tarjeta</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:16, marginTop:14}}>
                <div>
                  <label className="label">Cuenta receptora</label>
                  <div className="input" style={{display:"flex", alignItems:"center", gap:6}}>
                    <I.Bank size={13} style={{color:"var(--ink-3)"}}/>
                    <select value={bank} onChange={e => setBank(e.target.value)} style={{flex:1, background:"transparent", border:"none", fontSize:13}}>
                      <option>BAC | Cuenta operativa Q</option>
                      <option>Banrural | Cuenta corriente Q</option>
                      <option>Cuscatlán | Cuenta operaciones Q</option>
                      <option>Industrial | Cuenta servicios Q</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Referencia / N° transacción</label>
                  <input className="input" placeholder="TRF-09384..." value={ref} onChange={e => setRef(e.target.value)}/>
                </div>
              </div>
            </div>

            {/* Apply to invoices */}
            <div style={{padding:"18px 26px"}}>
              <div style={{display:"flex", alignItems:"center", marginBottom:10}}>
                <div style={{fontSize:12, fontWeight:500, color:"var(--ink)", letterSpacing:"0.04em", textTransform:"uppercase"}}>
                  Aplicar a facturas
                </div>
                <span className="badge badge-mute" style={{marginLeft:8}}>FIFO automático</span>
                <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11, marginLeft:"auto"}}>
                  <I.Wand size={11}/> Re-distribuir
                </button>
              </div>

              <div style={{background:"var(--paper-2)", border:"1px solid var(--line)", borderRadius:"var(--r-2)", overflow:"hidden"}}>
                <table className="table" style={{fontSize:12}}>
                  <thead>
                    <tr>
                      <th style={{width:30}}></th>
                      <th>Factura</th>
                      <th>Centro</th>
                      <th>Vencimiento</th>
                      <th className="num">Saldo</th>
                      <th className="num">A aplicar</th>
                      <th className="num">Nuevo saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custInvs.map(inv => {
                      const applied = selected[inv.id] || 0;
                      const line = LINES[inv.line];
                      const due = new Date(2026, 4, 19); due.setDate(due.getDate() - inv.dueAgo);
                      return (
                        <tr key={inv.id}>
                          <td><input type="checkbox" checked={!!applied} readOnly /></td>
                          <td className="num cell-strong">{inv.id}</td>
                          <td><span style={{display:"inline-flex", alignItems:"center", gap:6}}><span className={"dot " + line.dot}></span>{line.name}</span></td>
                          <td className="num cell-mute">{formatDateShort(due)} <span style={{color: inv.dueAgo > 0 ? "var(--wine)" : "var(--ink-4)", marginLeft:4}}>{inv.dueAgo > 0 ? `+${inv.dueAgo}d` : ""}</span></td>
                          <td className="num">{Q(inv.balance)}</td>
                          <td>
                            <input type="number" value={applied} onChange={e => setSelected({...selected, [inv.id]: +e.target.value})}
                              style={{width:100, textAlign:"right", background: applied > 0 ? "var(--olive-bg)" : "transparent", border:"1px solid var(--line-3)", borderRadius:3, padding:"3px 6px", fontFamily:"var(--mono)", fontSize:12, color:"var(--ink)"}}/>
                          </td>
                          <td className="num" style={{color: applied > 0 ? "var(--olive)" : "var(--ink-3)"}}>{Q(inv.balance - applied)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div style={{marginTop:14, padding:"12px 16px", background:"var(--bg-2)", borderRadius:"var(--r-2)", display:"flex", alignItems:"center", gap:24}}>
                <div>
                  <div style={{fontSize:10.5, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>Monto recibido</div>
                  <div className="num" style={{fontSize:18, fontWeight:500, color:"var(--ink)"}}>{Q(amount)}</div>
                </div>
                <div style={{color:"var(--ink-4)"}}><I.ArrowRight size={14}/></div>
                <div>
                  <div style={{fontSize:10.5, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>Aplicado</div>
                  <div className="num" style={{fontSize:18, fontWeight:500, color:"var(--olive)"}}>{Q(totalApplied)}</div>
                </div>
                <div style={{flex:1}}></div>
                <div>
                  <div style={{fontSize:10.5, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>Por aplicar</div>
                  <div className="num" style={{fontSize:18, fontWeight:500, color: unapplied !== 0 ? "var(--amber)" : "var(--ink-3)"}}>{Q(unapplied)}</div>
                </div>
                {unapplied > 0 && (
                  <div style={{fontSize:11.5, color:"var(--ink-3)", maxWidth:220, lineHeight:1.4}}>
                    El sobrante se registrará como <strong style={{color:"var(--ink)"}}>anticipo</strong> del cliente.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <span style={{fontSize:11.5, color:"var(--ink-3)"}}>
              <I.Info size={11} style={{verticalAlign:"-1px", marginRight:4}}/>
              Se generará automáticamente el recibo <span className="num">REC-2026-0189</span> y los asientos correspondientes.
            </span>
            <div className="spacer"></div>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-secondary">Guardar borrador</button>
            <button className="btn btn-primary" onClick={onClose}>Registrar cobro · {Q(amount)}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== AI Insights Center ===================== */

function AIInsightsCenter({ navigate }) {
  const { Q, AI_INSIGHTS, CUSTOMERS } = window.MOCK;
  const [staffCut, setStaffCut] = React.useState(0);
  const [priceUp, setPriceUp] = React.useState(0);
  const [collectionTarget, setCollectionTarget] = React.useState(50);

  // What-if calculation (mock)
  const baselineCash = 184000;
  const monthlyFromCollection = (collectionTarget / 41.5) * baselineCash;
  const monthlySavingFromStaff = staffCut * 14800;
  const revenueFromPriceUp = (priceUp / 100) * 281000;
  const projectedCash = monthlyFromCollection + monthlySavingFromStaff + revenueFromPriceUp;

  // 90-day forecast
  const forecast = [
    { d: "Hoy",    cash:  82000 },
    { d: "+15d",   cash: 124000 },
    { d: "+30d",   cash: 156000 + monthlySavingFromStaff/2 + revenueFromPriceUp/2 + (monthlyFromCollection-baselineCash)/2 },
    { d: "+45d",   cash: 188000 + monthlySavingFromStaff + revenueFromPriceUp + (monthlyFromCollection-baselineCash) },
    { d: "+60d",   cash: 215000 + monthlySavingFromStaff*2 + revenueFromPriceUp*2 + (monthlyFromCollection-baselineCash)*1.5 },
    { d: "+75d",   cash: 243000 + monthlySavingFromStaff*2 + revenueFromPriceUp*2 + (monthlyFromCollection-baselineCash)*2 },
    { d: "+90d",   cash: 271000 + monthlySavingFromStaff*3 + revenueFromPriceUp*3 + (monthlyFromCollection-baselineCash)*2.5 },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><em>Inteligencia</em> financiera</h1>
          <div className="page-subtitle">Asistente activo · Última sincronización hace 4 min · 3 alertas requieren acción</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Refresh size={13}/> Re-analizar</button>
          <button className="btn btn-primary"><I.Sparkles size={13}/> Generar reporte</button>
        </div>
      </div>

      {/* Insights cards */}
      <div style={{marginBottom:28}}>
        <div style={{fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:12}}>Insights detectados</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:14}}>
          {AI_INSIGHTS.map(ins => <InsightCard key={ins.id} ins={ins} />)}
        </div>
      </div>

      {/* What-if */}
      <div className="card" style={{marginBottom:28}}>
        <div className="card-head">
          <div className="card-title">Simulador What-if</div>
          <div className="card-actions" style={{fontSize:11, color:"var(--ink-4)"}}>Mové los controles y proyectá escenarios</div>
        </div>
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:36, marginBottom:8}}>
            <div>
              <WhatIfSlider
                label="¿Qué pasa si despido N personas del equipo operativo?"
                value={staffCut} setValue={setStaffCut}
                min={0} max={8} step={1} format={v => `${v} personas`}
                impact={`${monthlySavingFromStaff > 0 ? "+" : ""}${Q(monthlySavingFromStaff)}/mes en planilla`}
                impactColor="var(--olive)"
              />
              <WhatIfSlider
                label="¿Qué pasa si subo precios un % en facturación nueva?"
                value={priceUp} setValue={setPriceUp}
                min={0} max={25} step={1} format={v => `+${v}%`}
                impact={`${revenueFromPriceUp > 0 ? "+" : ""}${Q(Math.round(revenueFromPriceUp))}/mes en ingresos`}
                impactColor="var(--olive)"
              />
              <WhatIfSlider
                label="¿Qué pasa si subo la tasa de cobranza global a X%?"
                value={collectionTarget} setValue={setCollectionTarget}
                min={20} max={85} step={1} format={v => `${v}%`}
                impact={`${monthlyFromCollection > baselineCash ? "+" : ""}${Q(Math.round(monthlyFromCollection - baselineCash))}/mes cobrado`}
                impactColor={monthlyFromCollection > baselineCash ? "var(--olive)" : "var(--wine)"}
              />
            </div>

            <div>
              <div style={{fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:8}}>Proyección de cash · 90 días</div>
              <ForecastChart data={forecast} />
              <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:0, marginTop:18, background:"var(--bg-2)", borderRadius:"var(--r-2)", overflow:"hidden"}}>
                <ProjCard label="30 días" value={Math.round(forecast[2].cash)} />
                <ProjCard label="60 días" value={Math.round(forecast[4].cash)} />
                <ProjCard label="90 días" value={Math.round(forecast[6].cash)} primary />
              </div>
              <div className="card" style={{marginTop:14, background:"var(--paper)", borderColor:"var(--line-2)"}}>
                <div style={{padding:"12px 14px", fontSize:12, lineHeight:1.55, color:"var(--ink-2)", display:"flex", gap:10, alignItems:"flex-start"}}>
                  <div className="ai-avatar" style={{width:22, height:22, flexShrink:0, marginTop:1}}></div>
                  <div>
                    Con cobranza al <strong className="num">{collectionTarget}%</strong>{staffCut > 0 && <>, recortando <strong className="num">{staffCut}</strong> posiciones</>}{priceUp > 0 && <> y un <strong className="num">+{priceUp}%</strong> de precio</>}, terminás Q3 con <strong className="num" style={{color:"var(--olive)"}}>{Q(Math.round(forecast[6].cash))}</strong> en caja, vs <strong className="num">{Q(271000)}</strong> base.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat conversacional */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Conversación con el asistente</div>
          <div className="card-actions">
            <span className="badge badge-mute">Contexto: cierre de mayo · plan de cobranza</span>
          </div>
        </div>
        <div style={{padding:"18px 22px", display:"flex", flexDirection:"column", gap:14}}>
          <Msg role="user">¿Qué clientes debo llamar hoy si tengo solo 2 horas?</Msg>
          <Msg role="ai" data={[
            { lbl: "Recuperación potencial", val: "Q412,000" },
            { lbl: "Tiempo estimado",        val: "1h 50min" },
            { lbl: "Probabilidad cobro",     val: "73%" },
          ]} actions={[{ text: "Generar guion de llamada", primary: true }, { text: "Programar en calendario" }]}>
            Ordené tus 5 llamadas por <em className="serif">impacto × probabilidad de cobro</em>:
            <ol style={{margin:"8px 0 0 18px", padding:0, lineHeight:1.7}}>
              <li><strong>FUNDACIÓN GENESIS</strong> · Mariela Sandoval · <strong className="num">Q246K</strong> en +90d · escalar a directora</li>
              <li><strong>Banrural</strong> · Sergio Estrada · <strong className="num">Q121K</strong> · confirmar OC firmada</li>
              <li><strong>Microfinanciera Génesis</strong> · Ana Reyes · <strong className="num">Q68K</strong> · pendiente respuesta correo</li>
              <li><strong>Cuscatlán</strong> · Roberto Maldonado · <strong className="num">Q41K</strong> · pago habitualmente día 15</li>
              <li><strong>BAC</strong> · Diana Hernández · <strong className="num">Q29K</strong> · confirmar transferencia</li>
            </ol>
          </Msg>

          <Msg role="user">Si Genesis no paga este mes, ¿cómo afecta el flujo?</Msg>
          <Msg role="ai" data={[
            { lbl: "Cash mayo si paga",  val: "Q184,000" },
            { lbl: "Cash mayo sin pago", val: "Q138,000" },
            { lbl: "Gap a nómina",       val: "−Q47,000" },
          ]}>
            Si Genesis no paga sus <strong className="num">Q246K</strong> este mes, el cash de mayo cae <strong style={{color:"var(--wine)"}}>25%</strong>. Cubrís planilla y proveedores fijos pero no podés ejecutar la inversión en TalentTrack. <em className="serif">Recomendación:</em> activar la línea de crédito por 30 días o renegociar plan de pagos a 90 días con descuento de 3%.
          </Msg>
        </div>
        <div style={{padding:"14px 18px", borderTop:"1px solid var(--line-3)", background:"var(--paper)"}}>
          <div className="ai-input-box">
            <I.Sparkles size={14} style={{color:"var(--ink-3)"}} />
            <input placeholder="Preguntá sobre cualquier dato de la operación…" />
            <button className="ai-send"><I.Send size={12}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Msg({ role, children, data, actions }) {
  if (role === "user") return (
    <div style={{display:"flex"}}>
      <div className="msg-user" style={{maxWidth:"72%"}}>{children}</div>
    </div>
  );
  return (
    <div className="msg-ai" style={{maxWidth:"82%"}}>
      <div className="ai-label">Asistente</div>
      <div className="ai-text">{children}</div>
      {data && (
        <div className="ai-data-block" style={{display:"flex", gap:24, padding:"12px 16px"}}>
          {data.map((d, i) => (
            <div key={i} style={{flex:1}}>
              <div style={{fontSize:10, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:2}}>{d.lbl}</div>
              <div className="num" style={{fontSize:15, fontWeight:500, color:"var(--ink)"}}>{d.val}</div>
            </div>
          ))}
        </div>
      )}
      {actions && (
        <div className="ai-action-row" style={{marginTop:10}}>
          {actions.map((a, i) => (
            <button key={i} className={"ai-action-btn" + (a.primary ? " primary" : "")}>{a.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({ ins }) {
  const sevMap = {
    critical: { bg: "var(--wine-bg)",   fg: "var(--wine)",   icon:"Alert",     label:"Crítico" },
    warning:  { bg: "var(--amber-bg)",  fg: "var(--amber)",  icon:"Alert",     label:"Atención" },
    info:     { bg: "var(--indigo-bg)", fg: "var(--indigo)", icon:"Sparkles",  label:"Oportunidad" },
  };
  const s = sevMap[ins.severity];
  const Ico = I[s.icon];
  return (
    <div className="card" style={{borderColor: s.fg + "55"}}>
      <div style={{padding:"16px 18px 14px"}}>
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
          <span style={{display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:4, background: s.bg, color: s.fg, fontSize:10.5, fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase"}}>
            <Ico size={11}/> {s.label}
          </span>
          <span style={{marginLeft:"auto", fontSize:11, color:"var(--ink-4)"}}>Impacto</span>
          <span className="num" style={{fontSize:13, fontWeight:500, color: s.fg}}>{ins.impact}</span>
        </div>
        <div className="serif" style={{fontSize:15.5, lineHeight:1.3, color:"var(--ink)", letterSpacing:"-0.005em", marginBottom:8}}>
          {ins.title}
        </div>
        <div style={{fontSize:12, lineHeight:1.5, color:"var(--ink-3)", marginBottom:14}}>{ins.body}</div>
        <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
          {ins.actions.map((a, i) => (
            <button key={i} className={i === 0 ? "ai-action-btn primary" : "ai-action-btn"}>{a}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WhatIfSlider({ label, value, setValue, min, max, step, format, impact, impactColor }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{marginBottom:22}}>
      <div style={{fontSize:13, color:"var(--ink-2)", marginBottom:8, lineHeight:1.4}}>{label}</div>
      <div style={{display:"flex", alignItems:"center", gap:14}}>
        <div style={{flex:1, position:"relative", height:18, display:"flex", alignItems:"center"}}>
          <div style={{position:"absolute", left:0, right:0, height:4, background:"var(--bg-2)", borderRadius:2}}></div>
          <div style={{position:"absolute", left:0, width:`${pct}%`, height:4, background:"var(--ink)", borderRadius:2}}></div>
          <input type="range" min={min} max={max} step={step} value={value} onChange={e => setValue(+e.target.value)}
            style={{position:"absolute", inset:0, width:"100%", opacity:0, cursor:"pointer"}} />
          <div style={{position:"absolute", left:`calc(${pct}% - 8px)`, width:16, height:16, background:"var(--paper)", border:"2px solid var(--ink)", borderRadius:"50%", pointerEvents:"none"}}></div>
        </div>
        <div className="num" style={{minWidth:84, textAlign:"right", fontSize:14, fontWeight:500, color:"var(--ink)"}}>{format(value)}</div>
      </div>
      <div className="num" style={{fontSize:11.5, color: impactColor, marginTop:6}}>→ {impact}</div>
    </div>
  );
}

function ForecastChart({ data }) {
  const W = 460, H = 200, P = { l: 38, r: 12, t: 16, b: 24 };
  const max = Math.max(...data.map(d => d.cash)) * 1.1;
  const min = 0;
  const xs = (i) => P.l + ((W - P.l - P.r) * i) / (data.length - 1);
  const ys = (v) => H - P.b - ((H - P.t - P.b) * (v - min)) / (max - min);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(d.cash)}`).join(" ");
  const area = path + ` L ${xs(data.length-1)} ${H-P.b} L ${xs(0)} ${H-P.b} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%", height: 200, display:"block"}}>
      <defs>
        <linearGradient id="fcArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--olive)" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="var(--olive)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t, i) => (
        <line key={i} x1={P.l} x2={W-P.r} y1={ys(min + (max-min)*t)} y2={ys(min + (max-min)*t)} stroke="var(--line-3)" strokeDasharray={i === 0 ? "0" : "2 4"} />
      ))}
      <path d={area} fill="url(#fcArea)" />
      <path d={path} fill="none" stroke="var(--olive)" strokeWidth="1.75" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xs(i)} cy={ys(d.cash)} r="2.5" fill="var(--paper)" stroke="var(--olive)" strokeWidth="1.5"/>
          <text x={xs(i)} y={H - 8} fontSize="9.5" fill="var(--ink-4)" textAnchor="middle">{d.d}</text>
        </g>
      ))}
    </svg>
  );
}

function ProjCard({ label, value, primary }) {
  return (
    <div style={{padding:"10px 12px", borderRight:"1px solid var(--line-3)"}}>
      <div style={{fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", color:"var(--ink-4)"}}>{label}</div>
      <div className="num" style={{fontSize: primary ? 18 : 15, fontWeight: 500, color: primary ? "var(--olive)" : "var(--ink)", marginTop:2}}>
        {window.MOCK.Q(value)}
      </div>
    </div>
  );
}

window.CustomersList = CustomersList;
window.PaymentRegister = PaymentRegister;
window.AIInsightsCenter = AIInsightsCenter;
