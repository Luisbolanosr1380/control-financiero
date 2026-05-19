/* ===================== Command palette (⌘K) ===================== */

function CommandPalette({ onClose, navigate }) {
  const { CUSTOMERS, INVOICES } = window.MOCK;
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allItems = [
    { type: "action", label: "Nueva factura",        hint: "⌘N",    icon: "Plus",       action: () => { navigate("invoice-new"); onClose(); } },
    { type: "action", label: "Registrar cobro",      hint: "G C",   icon: "Coins",      action: () => { navigate("payment-new"); onClose(); } },
    { type: "action", label: "Generar reporte",      hint: "G R",   icon: "Download",   action: () => onClose() },
    { type: "nav",    label: "Dashboard",            hint: "G D",   icon: "Dashboard",  action: () => { navigate("dashboard"); onClose(); } },
    { type: "nav",    label: "Facturación",          hint: "G F",   icon: "Receipt",    action: () => { navigate("invoices"); onClose(); } },
    { type: "nav",    label: "Cobros",               hint: "G P",   icon: "Coins",      action: () => { navigate("payments"); onClose(); } },
    { type: "nav",    label: "Clientes",             hint: "G U",   icon: "Users",      action: () => { navigate("customers"); onClose(); } },
    { type: "nav",    label: "AI Insights",          hint: "G I",   icon: "Sparkles",   action: () => { navigate("ai"); onClose(); } },
    { type: "nav",    label: "Estados financieros",  hint: "G E",   icon: "Statement",  action: () => { navigate("statements"); onClose(); } },
    { type: "nav",    label: "Asientos",             hint: "G A",   icon: "Journal",    action: () => { navigate("journal"); onClose(); } },
    ...CUSTOMERS.slice(0, 6).map(c => ({
      type: "customer", label: c.short, hint: c.nit, icon: "Building",
      action: () => { navigate("customer", { customerId: c.id }); onClose(); }
    })),
    ...INVOICES.slice(0, 6).map(inv => ({
      type: "invoice", label: inv.id, hint: CUSTOMERS.find(c=>c.id===inv.custId).short, icon: "Receipt",
      action: () => { navigate("invoice-detail", { invoiceId: inv.id }); onClose(); }
    })),
  ];

  const filtered = q
    ? allItems.filter(it => it.label.toLowerCase().includes(q.toLowerCase()) || (it.hint || "").toLowerCase().includes(q.toLowerCase()))
    : allItems;

  const groups = {
    "Acciones rápidas": filtered.filter(i => i.type === "action"),
    "Navegar a":         filtered.filter(i => i.type === "nav"),
    "Clientes":          filtered.filter(i => i.type === "customer"),
    "Facturas":          filtered.filter(i => i.type === "invoice"),
  };

  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="modal" style={{alignItems:"flex-start", paddingTop:"12vh"}}>
        <div className="modal-card" style={{maxWidth:580, maxHeight:480}}>
          <div style={{padding:"12px 16px", borderBottom:"1px solid var(--line-3)", display:"flex", alignItems:"center", gap:10}}>
            <I.Search size={16} style={{color:"var(--ink-3)"}}/>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar facturas, clientes, asientos o ejecutar una acción…"
              style={{flex:1, background:"transparent", border:"none", fontSize:14, color:"var(--ink)"}}/>
            <span className="kbd">Esc</span>
          </div>
          <div style={{overflowY:"auto", padding:"6px 0"}}>
            {Object.entries(groups).map(([label, items]) => items.length > 0 && (
              <div key={label}>
                <div style={{padding:"8px 16px 4px", fontSize:10, color:"var(--ink-4)", letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:500}}>
                  {label}
                </div>
                {items.map((it, i) => {
                  const Ico = I[it.icon];
                  return (
                    <button key={i} onClick={it.action}
                      style={{width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 16px", textAlign:"left", color:"var(--ink-2)", fontSize:13, cursor:"pointer", background:"transparent", borderRadius:0}}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--paper-tint)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Ico size={14} style={{color:"var(--ink-3)"}}/>
                      <span style={{flex:1}}>{it.label}</span>
                      <span style={{fontSize:11, color:"var(--ink-4)", fontFamily: it.type === "customer" ? "var(--mono)" : "var(--sans)"}}>{it.hint}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{padding:40, textAlign:"center", color:"var(--ink-4)", fontSize:13}}>Sin resultados para "{q}"</div>
            )}
          </div>
          <div style={{padding:"8px 14px", borderTop:"1px solid var(--line-3)", display:"flex", gap:14, fontSize:11, color:"var(--ink-4)", background:"var(--bg-2)"}}>
            <span><span className="kbd">↑↓</span> Navegar</span>
            <span><span className="kbd">↵</span> Seleccionar</span>
            <span><span className="kbd">⌘K</span> Cerrar</span>
            <span style={{marginLeft:"auto"}}><I.Sparkles size={11} style={{verticalAlign:"-1px"}}/> Powered by AI</span>
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== Main App ===================== */

function App() {
  const [route, setRoute] = React.useState("dashboard");
  const [routeParams, setRouteParams] = React.useState({});
  const [aiOpen, setAiOpen] = React.useState(true);
  const [modal, setModal] = React.useState(null); // null | "invoice-new" | "payment-new" | "cmdk"

  const navigate = (r, params = {}) => {
    if (r === "invoice-new")  return setModal("invoice-new");
    if (r === "payment-new")  return setModal("payment-new");
    setRoute(r);
    setRouteParams(params);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal(m => m === "cmdk" ? null : "cmdk");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setModal("invoice-new");
      } else if (e.key === "Escape") {
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Crumbs / context per route
  const routeMeta = {
    dashboard:        { crumbs: ["Dashboard"],                       title: "Dashboard CFO" },
    invoices:         { crumbs: ["Operación","Facturación"],         title: "Listado de facturas" },
    "invoice-detail": { crumbs: ["Operación","Facturación", routeParams.invoiceId || "Detalle"], title: "Detalle factura" },
    payments:         { crumbs: ["Operación","Cobros"],              title: "Cobros y recibos" },
    customers:        { crumbs: ["Operación","Clientes"],            title: "Listado de clientes" },
    customer:         { crumbs: ["Operación","Clientes", "Cliente"], title: "Cuenta corriente" },
    expenses:         { crumbs: ["Gastos"],                          title: "Gastos" },
    banks:            { crumbs: ["Gastos","Bancos"],                 title: "Bancos" },
    payroll:          { crumbs: ["Gastos","Planilla"],               title: "Planilla" },
    debt:             { crumbs: ["Gastos","Deudas"],                 title: "Deudas" },
    journal:          { crumbs: ["Contabilidad","Asientos"],         title: "Asientos contables" },
    statements:       { crumbs: ["Contabilidad","Estados"],          title: "Estados financieros" },
    ai:               { crumbs: ["Inteligencia"],                    title: "AI Insights Center" },
  };

  const meta = routeMeta[route] || { crumbs: [route], title: route };

  return (
    <div className={"app" + (aiOpen ? " ai-open" : "")}>
      <Sidebar route={route} setRoute={navigate} />

      <div className="main">
        <Topbar
          crumbs={meta.crumbs}
          period="Mayo 2026"
          aiOpen={aiOpen}
          setAiOpen={setAiOpen}
          onSearch={() => setModal("cmdk")}
        />

        {route === "dashboard"        && <Dashboard navigate={navigate} />}
        {route === "invoices"         && <InvoicesList navigate={navigate} />}
        {route === "invoice-detail"   && <InvoiceDetail invoiceId={routeParams.invoiceId} navigate={navigate} />}
        {route === "payments"         && <PaymentsList navigate={navigate} openRegister={() => setModal("payment-new")} />}
        {route === "customers"        && <CustomersList navigate={navigate} />}
        {route === "customer"         && <CustomerDetail customerId={routeParams.customerId} navigate={navigate} />}
        {route === "journal"          && <JournalScreen />}
        {route === "statements"       && <StatementsScreen />}
        {route === "ai"               && <AIInsightsCenter navigate={navigate} />}
        {route === "expenses"         && <ComingSoon title="Gastos" subtitle="Categorización y aprobaciones · 1,247 transacciones acumuladas" icon="Expense" />}
        {route === "banks"            && <ComingSoon title="Bancos" subtitle="Conciliación bancaria · 4 cuentas activas" icon="Bank" />}
        {route === "payroll"          && <ComingSoon title="Planilla" subtitle="32 colaboradores · Próxima quincena el 31 de mayo" icon="Payroll" />}
        {route === "debt"             && <ComingSoon title="Deudas" subtitle="3 préstamos activos · Q420K saldo total" icon="Debt" />}
      </div>

      {aiOpen && (
        <AIPanel
          screenName={meta.title}
          context={{}}
          onClose={() => setAiOpen(false)}
        />
      )}

      {modal === "invoice-new"  && <InvoiceNew onClose={() => setModal(null)} />}
      {modal === "payment-new"  && <PaymentRegister onClose={() => setModal(null)} />}
      {modal === "cmdk"         && <CommandPalette onClose={() => setModal(null)} navigate={navigate} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
