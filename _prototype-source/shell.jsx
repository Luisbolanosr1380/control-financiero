/* ===================== Sidebar ===================== */

function Sidebar({ route, setRoute }) {
  const items = [
    { group: "Operación", items: [
      { id: "dashboard",   label: "Dashboard",     icon: "Dashboard" },
      { id: "invoices",    label: "Facturación",   icon: "Receipt", badge: { text: "5 vencidas", kind: "wine" } },
      { id: "payments",    label: "Cobros",        icon: "Coins" },
      { id: "customers",   label: "Clientes",      icon: "Users" },
    ]},
    { group: "Gastos", items: [
      { id: "expenses",    label: "Gastos",        icon: "Expense" },
      { id: "banks",       label: "Bancos",        icon: "Bank" },
      { id: "payroll",     label: "Planilla",      icon: "Payroll" },
      { id: "debt",        label: "Deudas",        icon: "Debt" },
    ]},
    { group: "Contabilidad", items: [
      { id: "journal",     label: "Asientos",      icon: "Journal" },
      { id: "statements",  label: "Estados Financieros", icon: "Statement" },
    ]},
    { group: "Inteligencia", items: [
      { id: "ai",          label: "AI Insights",   icon: "Sparkles", badge: { text: "3 alertas", kind: "warn" } },
    ]},
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">CF</div>
        <div>
          <div className="brand-name">Control Financiero</div>
          <div className="brand-sub">Sistema operativo</div>
        </div>
      </div>

      {items.map((grp) => (
        <div className="nav-group" key={grp.group}>
          <div className="nav-group-label">{grp.group}</div>
          {grp.items.map((it) => {
            const Ico = I[it.icon];
            return (
              <button key={it.id} className={"nav-item" + (route === it.id ? " active" : "")}
                onClick={() => setRoute(it.id)}>
                <Ico className="icon" />
                <span>{it.label}</span>
                {it.badge && (
                  <span className={"nav-badge" + (it.badge.kind === "warn" ? " warn" : "")}>
                    {it.badge.text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <div className="sidebar-footer">
        <div className="avatar">S</div>
        <div>
          <div className="user-name">Stark Méndez</div>
          <div className="user-role">CFO · Control Op.</div>
        </div>
      </div>
    </aside>
  );
}

/* ===================== Topbar ===================== */

function Topbar({ crumbs, period, aiOpen, setAiOpen, onSearch }) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "crumb-current" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="period-picker">
        <I.Calendar size={13} /> {period} <I.ChevDown size={13} />
      </div>

      <button className="global-search" onClick={onSearch}>
        <I.Search size={14} />
        <span>Buscar facturas, clientes, asientos…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="topbar-right">
        <button className="btn btn-secondary">
          <I.Plus size={13} /> Nuevo <span className="kbd">⌘N</span>
        </button>
        <button className={"btn " + (aiOpen ? "btn-secondary" : "btn-primary")}
                onClick={() => setAiOpen(!aiOpen)}>
          <I.Sparkles size={13} /> Asistente AI
        </button>
      </div>
    </header>
  );
}

/* ===================== AI Panel (lateral) ===================== */

function AIPanel({ context, onClose, screenName }) {
  const chips = context.chips || ["¿Quiénes son mis 5 deudores más críticos?","Resumen del mes","¿Qué hago hoy primero?","Proyectar cash a 30 días"];
  const messages = context.messages || [
    { role: "user", text: "¿Cuál es el estado de la cobranza este mes?" },
    { role: "ai",
      text: <>Cobranza de mayo va <strong>18% por debajo</strong> de marzo. Llevás <strong className="num">Q184K</strong> cobrados sobre <strong className="num">Q281K</strong> facturados. La caída es por <em>TalentTrack</em>, que sigue en 0% de cobranza acumulada.</>,
      data: [
        { lbl: "Cobrado mayo",  val: "Q184,000" },
        { lbl: "Esperado mayo", val: "Q225,000" },
        { lbl: "Gap",           val: "−Q41,000" },
      ],
      actions: [{ text: "Ver detalle por línea", primary: true }, { text: "Programar reunión TT" }]
    },
    { role: "user", text: "Mostrame los clientes que tienen +90 días" },
    { role: "ai",
      text: <>5 clientes concentran <strong className="num">Q733K</strong> en el bucket +90 días. <em>Fundación Genesis</em> lidera con <strong className="num">Q246K</strong> y no responde correos desde el 12 de abril.</>,
      actions: [{ text: "Abrir top 5 deudores", primary: true }, { text: "Generar cartas de cobro" }]
    },
  ];

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="ai-avatar"></div>
        <div style={{flex:1}}>
          <div className="ai-title">Asistente</div>
          <div className="ai-sub">Modelo financiero · contexto Q2 '26</div>
        </div>
        <button className="modal-close" onClick={onClose}><I.X size={16} /></button>
      </div>

      <div className="ai-context">
        <span className="ctx-label">Contexto</span>
        <span>·</span>
        <span style={{color:"var(--ink-2)"}}>{screenName}</span>
      </div>

      <div className="ai-chips">
        {chips.map((c, i) => <button key={i} className="chip">{c}</button>)}
      </div>

      <div className="ai-messages">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg-user">{m.text}</div>
          ) : (
            <div key={i} className="msg-ai">
              <div className="ai-label">Asistente</div>
              <div className="ai-text">{m.text}</div>
              {m.data && (
                <div className="ai-data-block">
                  {m.data.map((d, j) => (
                    <div className="ai-data-row" key={j}>
                      <span className="lbl">{d.lbl}</span>
                      <span className="val num">{d.val}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.actions && (
                <div className="ai-action-row">
                  {m.actions.map((a, j) => (
                    <button key={j} className={"ai-action-btn" + (a.primary ? " primary" : "")}>{a.text}</button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="ai-input">
        <div className="ai-input-box">
          <I.Sparkles size={14} style={{color:"var(--ink-3)"}} />
          <input placeholder="Preguntá algo o describí una acción…" />
          <button className="ai-send"><I.Send size={12} /></button>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar, Topbar, AIPanel });
