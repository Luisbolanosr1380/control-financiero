/* ===================== Dashboard CFO ===================== */

function Dashboard({ navigate }) {
  const { Q, SUMMARY, LINE_STATS, AGING, MONTHLY, INVOICES, CUSTOMERS, AI_INSIGHTS } = window.MOCK;

  // Top 5 deudores from customer data sorted
  const topDeudores = [...CUSTOMERS].sort((a,b) => b.totalBalance - a.totalBalance).slice(0, 5);

  return (
    <div className="page">
      {/* Header / greeting */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Buenos días, <em>Stark</em>.</h1>
          <div className="page-subtitle">Martes 19 de mayo, 2026 · Día 14 del cierre · 11 días para el corte</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Refresh size={13} /> Sincronizar</button>
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
        </div>
      </div>

      {/* AI Summary */}
      <div className="card" style={{ marginBottom: 20, background: "var(--paper)", borderColor: "var(--line-2)" }}>
        <div style={{display:"flex", padding:"22px 26px", gap:18, alignItems:"flex-start"}}>
          <div className="ai-avatar" style={{width:32, height:32, flexShrink:0}}></div>
          <div style={{flex:1}}>
            <div style={{fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-4)", fontWeight:500, marginBottom:8}}>
              Asistente · Resumen del día
            </div>
            <p className="serif" style={{fontSize:19, lineHeight:1.5, margin:0, color:"var(--ink)", maxWidth:920, letterSpacing:"-0.005em"}}>
              Tu cobranza de mayo está <strong style={{fontWeight:600}}>18% por debajo</strong> de marzo. <em style={{fontStyle:"italic", fontWeight:400}}>Cinco clientes</em> concentran <span className="num" style={{fontWeight:500}}>Q733,180</span> en aging +90 días — Fundación Genesis sola pesa <span className="num" style={{fontWeight:500}}>Q246K</span>. <em style={{fontStyle:"italic", fontWeight:400}}>Polígrafo</em> está liderando la salud con <span className="num" style={{fontWeight:500}}>49.4%</span> de tasa de cobranza; TalentTrack sigue en <span className="num" style={{fontWeight:500, color:"var(--wine)"}}>0%</span> acumulado.
            </p>
            <div style={{display:"flex", gap:8, marginTop:14}}>
              <button className="btn btn-primary" onClick={() => navigate("ai")}>
                <I.Sparkles size={13} /> Ver insights completos
              </button>
              <button className="btn btn-secondary" onClick={() => navigate("invoices")}>Revisar cartera vencida</button>
              <button className="btn btn-ghost">Marcar como leído</button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid" style={{marginBottom: 22}}>
        <Kpi label="Facturado · mayo"     value={SUMMARY.facturadoMes}     prev={SUMMARY.facturadoPrev} positiveIsGood />
        <Kpi label="Cobrado · mayo"       value={SUMMARY.cobradoMes}       prev={SUMMARY.cobradoPrev}   positiveIsGood />
        <Kpi label="Por cobrar · total"   value={SUMMARY.porCobrarTotal}   neutral />
        <Kpi label="Vencido +90 d"        value={SUMMARY.vencido90}        invertColor warnAlways />
        <Kpi label="Flujo neto · mayo"    value={SUMMARY.flujoNeto}        prev={SUMMARY.flujoPrev}     positiveIsGood />
        <Kpi label="Margen operativo"     value={SUMMARY.margenOperativo}  prev={SUMMARY.margenPrev}    percent  positiveIsGood />
      </div>

      {/* Two-column: lines + alerts */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 380px", gap:20, marginBottom:22}}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Líneas de negocio</div>
            <div className="card-actions">
              <span style={{fontSize:11, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>4 líneas activas</span>
            </div>
          </div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)"}}>
            {LINE_STATS.map((ln) => <LineCard key={ln.line} ln={ln} />)}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Alertas activas</div>
            <span className="badge badge-wine">3</span>
            <div className="card-actions">
              <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11}} onClick={() => navigate("ai")}>
                Ver todas <I.Chevron size={11} />
              </button>
            </div>
          </div>
          <div style={{padding: 0}}>
            {AI_INSIGHTS.map((al, i) => (
              <AlertRow key={al.id} alert={al} last={i === AI_INSIGHTS.length-1} />
            ))}
          </div>
        </div>
      </div>

      {/* Chart + Aging */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 460px", gap:20, marginBottom:22}}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Evolución 12 meses</div>
            <span style={{fontSize:11, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>Facturado vs Cobrado</span>
            <div className="card-actions">
              <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11}}>12M</button>
              <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11, color:"var(--ink-4)"}}>6M</button>
              <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11, color:"var(--ink-4)"}}>YTD</button>
            </div>
          </div>
          <div className="card-pad">
            <TrendChart data={MONTHLY} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Aging de cartera</div>
            <div className="card-actions">
              <span className="num" style={{fontSize:13, fontWeight:500, color:"var(--ink)"}}>Q1,614,094</span>
            </div>
          </div>
          <div className="card-pad">
            <AgingBars data={AGING} />
            <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:14, lineHeight:1.55, paddingTop:12, borderTop:"1px solid var(--line-3)"}}>
              <strong style={{color:"var(--wine)", fontWeight:600}}>68.8%</strong> de la cartera está vencida. El bucket <strong style={{color:"var(--ink)"}}>+90 días</strong> concentra <span className="num">Q1.11M</span> en <span className="num">317</span> facturas — la mayoría de TalentTrack y Socioeconómico.
            </div>
          </div>
        </div>
      </div>

      {/* Top deudores */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Top 5 deudores</div>
          <div className="card-actions">
            <button className="btn btn-ghost" style={{padding:"3px 8px", fontSize:11}} onClick={() => navigate("customers")}>
              Ver todos los clientes <I.Chevron size={11} />
            </button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th style={{width: 26}}></th>
              <th>Cliente</th>
              <th>Contacto</th>
              <th className="num">Saldo total</th>
              <th className="num">Vencido</th>
              <th className="num">% vencido</th>
              <th>Aging</th>
              <th>Última gestión</th>
              <th style={{width: 80}}></th>
            </tr>
          </thead>
          <tbody>
            {topDeudores.map((c, i) => {
              const pct = Math.round((c.vencido / c.totalBalance) * 100);
              return (
                <tr key={c.id} className="clickable" onClick={() => navigate("customer", { customerId: c.id })}>
                  <td className="num cell-mute">{i + 1}</td>
                  <td className="cell-strong">{c.short}</td>
                  <td className="cell-mute">{c.contact}</td>
                  <td className="num cell-strong">{Q(c.totalBalance)}</td>
                  <td className="num" style={{color: c.vencido > 0 ? "var(--wine)" : "var(--ink-3)"}}>{Q(c.vencido)}</td>
                  <td className="num">{pct}%</td>
                  <td><MiniAgingBar customer={c} /></td>
                  <td className="cell-mute" style={{fontSize:11.5}}>{["hace 2d","hace 5d","hace 12d","hace 3d","ayer"][i]}</td>
                  <td><button className="modal-close"><I.More size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== KPI Card ===================== */

function Kpi({ label, value, prev, percent, positiveIsGood, neutral, invertColor, warnAlways }) {
  const { Q } = window.MOCK;
  const delta = prev != null ? ((value - prev) / Math.abs(prev)) * 100 : null;
  const isUp = delta != null && delta >= 0;
  let cls = "";
  if (warnAlways) cls = "neg";
  else if (delta != null && !neutral) {
    if (positiveIsGood) cls = isUp ? "pos" : "neg";
    else cls = isUp ? "neg" : "pos";
  }
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {percent ? (
          <>{value.toFixed(1)}<span style={{fontSize:14, color:"var(--ink-3)", marginLeft:2}}>%</span></>
        ) : (
          <><span className="currency">Q</span>{value.toLocaleString("en-US")}</>
        )}
      </div>
      {delta != null && (
        <div className={"kpi-delta " + cls}>
          {isUp ? <I.ArrowUp size={11} /> : <I.ArrowDown size={11} />}
          {Math.abs(delta).toFixed(1)}%
          <span className="vs">vs abril</span>
        </div>
      )}
      {warnAlways && (
        <div className="kpi-delta neg">
          <I.Alert size={11} /> 317 facturas <span className="vs">crítico</span>
        </div>
      )}
    </div>
  );
}

/* ===================== Line Card ===================== */

function LineCard({ ln }) {
  const { Q, LINES } = window.MOCK;
  const lineMeta = LINES[ln.line];
  const healthDot = { good: "var(--olive)", warn: "var(--amber)", bad: "var(--wine)" }[ln.health];
  const healthLabel = { good: "Saludable", warn: "Riesgo", bad: "Crítico" }[ln.health];
  return (
    <div style={{padding:18, borderRight:"1px solid var(--line-3)", position:"relative"}}>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:14}}>
        <span className={"dot " + lineMeta.dot}></span>
        <span style={{fontSize:13, fontWeight:500, color:"var(--ink)"}}>{ln.name}</span>
        <span style={{marginLeft:"auto", fontSize:10, color:"var(--ink-4)", fontFamily:"var(--mono)"}}>{ln.count}</span>
      </div>
      <div style={{display:"flex", alignItems:"baseline", gap:8, marginBottom:4}}>
        <span className="num" style={{fontSize:22, fontWeight:500, letterSpacing:"-0.02em"}}>{ln.tasa.toFixed(1)}%</span>
        <span style={{fontSize:10.5, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase"}}>tasa cobranza</span>
      </div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4, marginBottom:10}}>
        <span style={{width:6, height:6, borderRadius:"50%", background: healthDot}}></span>
        <span style={{fontSize:11, color:"var(--ink-3)"}}>{healthLabel}</span>
      </div>
      {/* progress bar */}
      <div style={{height:4, background:"var(--bg-2)", borderRadius:2, overflow:"hidden"}}>
        <div style={{height:"100%", width: `${ln.tasa}%`, background: healthDot, borderRadius:2}}></div>
      </div>
      <div style={{display:"flex", justifyContent:"space-between", marginTop:10, fontSize:11, color:"var(--ink-3)"}}>
        <span>Facturado <span className="num" style={{color:"var(--ink-2)"}}>{Q(ln.facturado)}</span></span>
        <span>Cobrado <span className="num" style={{color:"var(--ink-2)"}}>{Q(ln.cobrado)}</span></span>
      </div>
    </div>
  );
}

/* ===================== Alert Row ===================== */

function AlertRow({ alert, last }) {
  const sevMap = {
    critical: { icon: "Alert",  cls: "wine",   label: "Crítico" },
    warning:  { icon: "Alert",  cls: "warn",   label: "Atención" },
    info:     { icon: "Info",   cls: "indigo", label: "Info" },
  };
  const sev = sevMap[alert.severity];
  const Ico = I[sev.icon];
  const bgMap = { wine:"var(--wine)", warn:"var(--amber)", indigo:"var(--indigo)" };
  return (
    <div style={{padding:"14px 20px", borderBottom: last ? "none" : "1px solid var(--line-3)"}}>
      <div style={{display:"flex", alignItems:"flex-start", gap:10, marginBottom:6}}>
        <div style={{width:18, height:18, borderRadius:4, background:bgMap[sev.cls], color:"var(--paper)", display:"grid", placeItems:"center", flexShrink:0, marginTop:1}}>
          <Ico size={11} />
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:10, color:"var(--ink-4)", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:500, marginBottom:3}}>{sev.label}</div>
          <div style={{fontSize:12.5, fontWeight:500, color:"var(--ink)", lineHeight:1.35, marginBottom:4}}>{alert.title}</div>
          <div style={{fontSize:11.5, color:"var(--ink-3)", lineHeight:1.5}}>{alert.body}</div>
        </div>
        <span className="num" style={{fontSize:11.5, color: alert.severity === "info" ? "var(--olive)" : "var(--wine)", fontWeight:500, whiteSpace:"nowrap"}}>{alert.impact}</span>
      </div>
    </div>
  );
}

/* ===================== Trend chart ===================== */

function TrendChart({ data }) {
  const W = 720, H = 220, P = { l: 40, r: 12, t: 16, b: 28 };
  const maxV = Math.max(...data.flatMap(d => [d.fact, d.cob])) * 1.05;
  const xs = (i) => P.l + ((W - P.l - P.r) * i) / (data.length - 1);
  const ys = (v) => H - P.b - ((H - P.t - P.b) * v) / maxV;
  const pathFact = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(d.fact)}`).join(" ");
  const pathCob  = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(d.cob)}`).join(" ");
  const areaCob  = pathCob + ` L ${xs(data.length-1)} ${H-P.b} L ${xs(0)} ${H-P.b} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => t * maxV);

  return (
    <div>
      <div style={{display:"flex", gap:18, marginBottom:8, fontSize:11.5, color:"var(--ink-3)"}}>
        <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
          <span style={{width:10, height:2, background:"var(--ink)", display:"inline-block"}}></span> Facturado
        </span>
        <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
          <span style={{width:10, height:2, background:"var(--amber)", display:"inline-block"}}></span> Cobrado
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%", height: 220, display:"block"}}>
        <defs>
          <linearGradient id="cobArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="var(--amber)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W-P.r} y1={ys(t)} y2={ys(t)} stroke="var(--line-3)" strokeDasharray={i === 0 ? "0" : "2 4"} />
            <text x={P.l - 6} y={ys(t)+3} fontSize="9.5" fill="var(--ink-4)" textAnchor="end" fontFamily="var(--mono)">
              {t === 0 ? "0" : "Q" + Math.round(t/1000) + "K"}
            </text>
          </g>
        ))}
        <path d={areaCob} fill="url(#cobArea)" />
        <path d={pathFact} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
        <path d={pathCob} fill="none" stroke="var(--amber)" strokeWidth="1.5" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={xs(i)} cy={ys(d.fact)} r="2.5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
            <circle cx={xs(i)} cy={ys(d.cob)} r="2.5" fill="var(--paper)" stroke="var(--amber)" strokeWidth="1.5" />
            <text x={xs(i)} y={H - 10} fontSize="9.5" fill="var(--ink-4)" textAnchor="middle">{d.m}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ===================== Aging bars ===================== */

function AgingBars({ data }) {
  const total = data.reduce((s,d) => s + d.amount, 0);
  return (
    <div>
      <div style={{display:"flex", height:34, borderRadius:5, overflow:"hidden", border:"1px solid var(--line)"}}>
        {data.map((b, i) => {
          const w = (b.amount / total) * 100;
          return (
            <div key={i} className={"aging-seg " + b.cls} style={{flex: w, minWidth: 24}}>
              {w > 10 && <span style={{fontFamily:"var(--mono)", fontSize:10.5, fontWeight:600}}>{w.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(5, 1fr)", marginTop:12, gap:0}}>
        {data.map((b, i) => (
          <div key={i} style={{textAlign:"center", borderRight: i < 4 ? "1px solid var(--line-3)": "none", padding:"0 4px"}}>
            <div style={{fontSize:10, color:"var(--ink-4)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4}}>{b.label}</div>
            <div className="num" style={{fontSize:12.5, color: i === 4 ? "var(--wine)" : "var(--ink)", fontWeight:500}}>
              {window.MOCK.Q(b.amount)}
            </div>
            <div style={{fontSize:10, color:"var(--ink-4)", marginTop:2}} className="num">{b.count} fact.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================== Mini aging bar (table cell) ===================== */

function MiniAgingBar({ customer }) {
  // Reconstruct distribution roughly from customer
  const total = customer.totalBalance;
  const vencido = customer.vencido;
  const corriente = total - vencido;
  const segs = [
    { v: corriente,           cls: "aging-current" },
    { v: vencido * 0.15,      cls: "aging-1-30" },
    { v: vencido * 0.20,      cls: "aging-31-60" },
    { v: vencido * 0.20,      cls: "aging-61-90" },
    { v: vencido * 0.45,      cls: "aging-90" },
  ];
  return (
    <div style={{display:"flex", height:14, width:120, borderRadius:3, overflow:"hidden", border:"1px solid var(--line-3)"}}>
      {segs.map((s, i) => s.v > 0 && (
        <div key={i} className={s.cls} style={{flex: s.v, height:"100%"}}></div>
      ))}
    </div>
  );
}

window.Dashboard = Dashboard;
