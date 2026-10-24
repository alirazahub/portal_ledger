import { useCallback, useEffect, useMemo, useState } from "react";

const money = (value) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const dateLabel = (value) => value ? new Date(value + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dayDelta = (value) => {
  if (!value) return 0;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
};
const initials = (value = "") => value.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
const effectiveStatus = (invoice) => invoice.status !== "Paid" && invoice.status !== "Draft" && dayDelta(invoice.due) < 0 ? "Overdue" : invoice.status;

async function request(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload.data;
}

function Modal({ title, description, onClose, children }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal-header"><div><h2 id="modal-title">{title}</h2><p>{description}</p></div><button className="icon-close" aria-label="Close" onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>;
}

function App() {
  const [page, setPage] = useState("overview");
  const [invoices, setInvoices] = useState([]);
  const [portals, setPortals] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceRows, portalRows, documentRows] = await Promise.all([
        request("/invoices"), request("/portals"), request("/documents"),
      ]);
      setInvoices(invoiceRows);
      setPortals(portalRows);
      setDocuments(documentRows);
    } catch (err) {
      setError(err.message + " Make sure MongoDB and the API server are running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredInvoices = useMemo(() => invoices.filter((invoice) => {
    const status = effectiveStatus(invoice);
    const matchesStatus = statusFilter === "all" || status.toLowerCase() === statusFilter.toLowerCase();
    const haystack = [invoice.number, invoice.client, invoice.portal, invoice.reference].join(" ").toLowerCase();
    return matchesStatus && haystack.includes(query.trim().toLowerCase());
  }).sort((a, b) => {
    if ((a.status === "Paid") !== (b.status === "Paid")) return a.status === "Paid" ? 1 : -1;
    return a.due.localeCompare(b.due);
  }), [invoices, query, statusFilter]);

  const openInvoices = invoices.filter((item) => item.status !== "Paid");
  const overdueInvoices = openInvoices.filter((item) => effectiveStatus(item) === "Overdue");
  const dueSoon = openInvoices.filter((item) => dayDelta(item.due) >= 0 && dayDelta(item.due) <= 7);
  const outstanding = openInvoices.reduce((sum, item) => sum + Number(item.amount), 0);
  const dueSoonTotal = dueSoon.reduce((sum, item) => sum + Number(item.amount), 0);
  const overdueTotal = overdueInvoices.reduce((sum, item) => sum + Number(item.amount), 0);

  function notify(message) { setToast(message); }
  function navigate(target) { setPage(target); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function saveInvoice(event) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.amount = Number(payload.amount);
    try {
      await request("/invoices", { method: "POST", body: JSON.stringify(payload) });
      setModal(""); await refresh(); navigate("invoices"); notify("Invoice added");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function savePortal(event) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const existing = portals.find((item) => item.name.toLowerCase() === payload.name.trim().toLowerCase());
      if (existing) await request("/portals/" + existing._id, { method: "PATCH", body: JSON.stringify(payload) });
      else await request("/portals", { method: "POST", body: JSON.stringify(payload) });
      setModal(""); await refresh(); notify("Portal shortcut saved");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function saveDocument(event) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      await request("/documents", { method: "POST", body: JSON.stringify(payload) });
      setModal(""); await refresh(); notify("Renewal reminder saved");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function markPaid(invoice) {
    try {
      await request("/invoices/" + invoice._id, { method: "PATCH", body: JSON.stringify({ status: "Paid" }) });
      setSelected(null); await refresh(); notify(invoice.number + " marked paid");
    } catch (err) { setError(err.message); }
  }
  async function editNote(invoice) {
    const note = window.prompt("Add a note or next step", invoice.note || "");
    if (note === null) return;
    try {
      await request("/invoices/" + invoice._id, { method: "PATCH", body: JSON.stringify({ note }) });
      setSelected({ ...invoice, note }); await refresh(); notify("Note saved");
    } catch (err) { setError(err.message); }
  }
  function exportCsv() {
    const rows = [["Invoice", "Customer", "Portal", "Status", "Submitted", "Due", "Amount EUR", "Reference", "Note"],
      ...invoices.map((i) => [i.number, i.client, i.portal, effectiveStatus(i), i.submitted, i.due, i.amount, i.reference, i.note])];
    const csv = rows.map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "portal-ledger-invoices.csv"; link.click(); URL.revokeObjectURL(link.href);
    notify("Invoice report exported");
  }

  const portalNames = [...new Set([...portals.map((p) => p.name), ...invoices.map((i) => i.portal)])];
  const followups = openInvoices.filter((i) => i.status !== "Draft").sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" });

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span><b>Portal Ledger</b><small>Supplier workspace</small></span></div>
      <p className="nav-label">Workspace</p>
      <nav className="nav-list" aria-label="Workspace">
        {[["overview", "◫", "Overview"], ["invoices", "▤", "Invoices"], ["portals", "↗", "Customer portals"], ["documents", "▧", "Documents"]].map(([id, icon, label]) =>
          <button key={id} className={page === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}>
            <span className="nav-icon">{icon}</span><span>{label}</span>{id === "invoices" && <span className="nav-count">{openInvoices.length}</span>}
          </button>)}
      </nav>
      <div className="sidebar-bottom"><div className="workspace-note"><b>One clear picture</b><p>Keep invoice updates and portal links together.</p><div className="progress"><i /></div></div><div className="workspace-user"><span className="user-avatar">AS</span><span><b>Acme Services</b><small>Workspace</small></span></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{page === "overview" ? "Overview" : page === "invoices" ? "Invoices" : page === "portals" ? "Customer portals" : "Documents"}</b></div>
        <div className="top-actions"><button className="button" onClick={exportCsv}>↓ Export</button><button className="button primary" onClick={() => setModal("invoice")}>＋ New invoice</button></div>
      </header>
      <div className="content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {loading && <div className="loading-card">Connecting to your Portal Ledger API…</div>}
        {!loading && page === "overview" && <section>
          <div className="page-head"><div><div className="eyebrow">{today}</div><h1>Good morning, Alex</h1><p>Here’s what needs attention across your customer portals.</p></div><div className="head-buttons"><button className="button" onClick={exportCsv}>↓ Export report</button><button className="button primary" onClick={() => setModal("invoice")}>＋ Add invoice</button></div></div>
          <div className="stats-grid">
            <Stat label="Outstanding" value={money(outstanding)} foot="Across open invoices" icon="€" tone="green" />
            <Stat label="Due this week" value={money(dueSoonTotal)} foot="Next seven days" icon="◷" tone="amber" />
            <Stat label="Overdue" value={money(overdueTotal)} foot={overdueInvoices.length + " invoices need attention"} icon="!" tone="red" />
            <Stat label="Open invoices" value={openInvoices.length} foot={invoices.length - openInvoices.length + " paid this period"} icon="▤" tone="blue" />
          </div>
          <div className="dashboard-grid">
            <InvoicePanel invoices={filteredInvoices.slice(0, 6)} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={setSelected} />
            <div className="side-stack">
              <section className="panel side-panel"><div className="side-heading"><b>Portal activity</b><button className="text-link" onClick={() => navigate("portals")}>View all</button></div>
                {portalNames.slice(0, 4).map((name, index) => { const rows = invoices.filter((i) => i.portal === name && i.status !== "Paid"); return <div className="portal-row" key={name}><span className={"portal-icon tone-" + (index % 4)}>{initials(name)}</span><span className="portal-info"><b>{name}</b><small>{rows.length} open invoice{rows.length === 1 ? "" : "s"}</small></span><strong>{money(rows.reduce((sum, i) => sum + Number(i.amount), 0))}</strong></div>; })}
                {!portalNames.length && <Empty text="No portals tracked yet." />}
              </section>
              <section className="panel side-panel"><div className="side-heading"><b>Next follow-ups</b><button className="text-link" onClick={() => navigate("invoices")}>View queue</button></div>
                {followups.map((item) => <Followup key={item._id} invoice={item} onClick={() => setSelected(item)} />)}
                {!followups.length && <Empty text="Nothing to follow up." />}
              </section>
              <section className="panel side-panel"><div className="side-heading"><b>Documents</b><button className="text-link" onClick={() => navigate("documents")}>Manage</button></div>
                {documents.slice(0, 3).map((doc) => <div className="document-row" key={doc._id}><span>▧</span><b>{doc.name}</b><small>{dateLabel(doc.expiresAt)}</small></div>)}
                {!documents.length && <Empty text="No documents tracked yet." />}
              </section>
            </div>
          </div>
          <p className="footnote">Portal Ledger tracks what your team records. It does not read customer portals or store portal passwords.</p>
        </section>}

        {!loading && page === "invoices" && <section>
          <div className="page-head"><div><div className="eyebrow">Receivables</div><h1>Invoices</h1><p>Track invoices submitted through each customer portal.</p></div><div className="head-buttons"><button className="button" onClick={exportCsv}>↓ Export</button><button className="button primary" onClick={() => setModal("invoice")}>＋ Add invoice</button></div></div>
          <InvoicePanel invoices={filteredInvoices} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={setSelected} caption={invoices.length + " invoices · " + openInvoices.length + " open"} />
        </section>}

        {!loading && page === "portals" && <section>
          <div className="page-head"><div><div className="eyebrow">Customer access</div><h1>Customer portals</h1><p>Keep portal shortcuts beside invoice activity. Access is opened manually.</p></div><div className="head-buttons"><button className="button primary" onClick={() => setModal("portal")}>＋ Add portal</button></div></div>
          <div className="cards-grid">{portalNames.map((name, index) => { const portal = portals.find((p) => p.name === name); const rows = invoices.filter((i) => i.portal === name); const open = rows.filter((i) => i.status !== "Paid"); return <article className="portal-card" key={name}><div className="portal-card-head"><span className={"portal-icon tone-" + (index % 4)}>{initials(name)}</span><span className={"pill " + (portal?.url ? "pill-green" : "pill-muted")}>{portal?.url ? "Link saved" : "No link"}</span></div><h2>{name}</h2><p>{portal?.url ? "Shortcut saved" : "Add a URL for quick access"}</p><div className="portal-metrics"><div><b>{rows.length}</b><small>Total</small></div><div><b>{money(open.reduce((sum, i) => sum + Number(i.amount), 0))}</b><small>Outstanding</small></div><div><b>{rows.filter((i) => effectiveStatus(i) === "Overdue").length}</b><small>Overdue</small></div></div><div className="card-actions">{portal?.url ? <a className="button" href={portal.url} target="_blank" rel="noreferrer">↗ Open portal</a> : <button className="button" onClick={() => setModal("portal")}>＋ Add link</button>}<button className="button" onClick={() => navigate("invoices")}>Invoices</button></div></article>; })}</div>
          {!portalNames.length && <Empty text="Add an invoice or portal to get started." />}
          <p className="footnote">Portal Ledger never asks for portal credentials. Use links only for portals you’re authorized to access.</p>
        </section>}

        {!loading && page === "documents" && <section>
          <div className="page-head"><div><div className="eyebrow">Shared paperwork</div><h1>Documents</h1><p>Track renewal dates for documents customers may request.</p></div><div className="head-buttons"><button className="button primary" onClick={() => setModal("document")}>＋ Add document</button></div></div>
          <div className="cards-grid">{documents.map((doc) => <article className="document-card" key={doc._id}><div className="portal-card-head"><span className="document-icon">▧</span><span className={"pill " + (dayDelta(doc.expiresAt) <= 30 ? "pill-amber" : "pill-green")}>{dayDelta(doc.expiresAt) <= 30 ? "Renew soon" : "Active"}</span></div><h2>{doc.name}</h2><p>{doc.category}</p><div className="document-foot"><span>Renewal / expiry</span><b>{dateLabel(doc.expiresAt)}</b></div></article>)}</div>
          {!documents.length && <Empty text="No documents yet. Add a renewal date to track it here." />}
          <p className="footnote">This MVP stores document names and dates only. It does not upload files.</p>
        </section>}
      </div>
    </main>

    {modal === "invoice" && <Modal title="Add invoice" description="Record the customer portal and payment dates." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={saveInvoice}>
        <Field label="Invoice number"><input name="number" required maxLength="80" placeholder="INV-2026-014" /></Field>
        <Field label="Amount (€)"><input name="amount" type="number" min="0.01" step="0.01" required placeholder="2400" /></Field>
        <Field label="Customer"><input name="client" required maxLength="160" placeholder="Customer company" /></Field>
        <Field label="Portal"><input name="portal" list="portal-options" required maxLength="120" placeholder="Customer portal" /><datalist id="portal-options">{portalNames.map((name) => <option key={name} value={name} />)}</datalist></Field>
        <Field label="Submitted date"><input name="submitted" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
        <Field label="Due date"><input name="due" type="date" required /></Field>
        <Field label="Status"><select name="status" defaultValue="Submitted"><option>Draft</option><option>Submitted</option><option>Approved</option><option>Processing</option></select></Field>
        <Field label="Portal reference"><input name="reference" maxLength="120" placeholder="Submission / PO reference" /></Field>
        <Field label="Note / next step" full><textarea name="note" maxLength="2000" placeholder="Rejection reason, AP contact, or next action" /></Field>
        <div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save invoice"}</button></div>
      </form>
    </Modal>}
    {modal === "portal" && <Modal title="Add portal shortcut" description="Save a URL for quick access. Portal passwords aren’t stored." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={savePortal}><Field label="Portal / customer name"><input name="name" required maxLength="160" placeholder="Customer portal" /></Field><Field label="Portal URL"><input name="url" type="url" pattern="https?://.+" required placeholder="https://portal.example.com" /></Field><div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save portal"}</button></div></form>
    </Modal>}
    {modal === "document" && <Modal title="Add document reminder" description="Track the document name and renewal date. This MVP doesn’t upload files." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={saveDocument}><Field label="Document name"><input name="name" required maxLength="160" placeholder="Insurance certificate" /></Field><Field label="Renewal date"><input name="expiresAt" type="date" required /></Field><Field label="Category" full><select name="category"><option>Insurance</option><option>Registration</option><option>Tax document</option><option>Safety certificate</option><option>Other</option></select></Field><div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save reminder"}</button></div></form>
    </Modal>}
    {selected && <Modal title={selected.number} description={selected.client + " · " + effectiveStatus(selected)} onClose={() => setSelected(null)}>
      <div className="detail-amount">{money(selected.amount)}</div><div className="detail-grid">
        <Detail label="Customer portal" value={selected.portal} /><Detail label="Portal reference" value={selected.reference || "Not recorded"} /><Detail label="Submitted" value={dateLabel(selected.submitted)} /><Detail label="Due date" value={dateLabel(selected.due)} />
      </div><div className="detail-note"><b>Latest note</b><p>{selected.note || "No note recorded."}</p></div>
      <div className="modal-actions"><button className="button" onClick={() => editNote(selected)}>＋ Add note</button>{selected.status !== "Paid" && <button className="button primary" onClick={() => markPaid(selected)}>✓ Mark paid</button>}</div>
    </Modal>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function Stat({ label, value, foot, icon, tone }) {
  return <article className="stat-card"><div className="stat-label">{label}<span className={"stat-icon " + tone}>{icon}</span></div><strong>{value}</strong><small>{foot}</small></article>;
}
function Empty({ text }) { return <div className="empty-state">{text}</div>; }
function Followup({ invoice, onClick }) {
  const late = effectiveStatus(invoice) === "Overdue";
  return <button className="followup-row" onClick={onClick}><span className={"followup-icon " + (late ? "late" : "")}>{late ? "!" : "↗"}</span><span><b>{late ? "Follow up: " : "Check status: "}{invoice.client}</b><small>{invoice.number} · {money(invoice.amount)} · {late ? Math.abs(dayDelta(invoice.due)) + " days overdue" : "Due " + dateLabel(invoice.due)}</small></span></button>;
}
function InvoicePanel({ invoices, query, setQuery, statusFilter, setStatusFilter, onSelect, caption }) {
  return <section className="panel"><div className="panel-header"><div><b>Invoice activity</b><small>{caption || "Submissions, approvals, and payment status"}</small></div><div className="filter-row"><input aria-label="Search invoices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoices" /><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option>Submitted</option><option>Approved</option><option>Processing</option><option>Draft</option><option>Paid</option><option>Overdue</option></select></div></div>
    {!invoices.length ? <Empty text="No invoices match. Add an invoice to start tracking." /> : <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Portal</th><th>Status</th><th>Due date</th><th>Amount</th></tr></thead><tbody>{invoices.map((invoice) => { const status = effectiveStatus(invoice); const delta = dayDelta(invoice.due); return <tr key={invoice._id} onClick={() => onSelect(invoice)}><td><b>{invoice.number}</b><small>{invoice.reference || "No portal reference"}</small></td><td><div className="customer-cell"><span className="client-initials">{initials(invoice.client)}</span><span><b>{invoice.client}</b><small>Submitted {dateLabel(invoice.submitted)}</small></span></div></td><td><span className="portal-dot" />{invoice.portal}</td><td><span className={"status " + status.toLowerCase()}>{status}</span></td><td className={status === "Overdue" ? "text-red" : delta >= 0 && delta <= 7 && status !== "Paid" ? "text-amber" : ""}>{invoice.status === "Paid" ? "Paid" : status === "Overdue" ? Math.abs(delta) + "d overdue" : delta === 0 ? "Due today" : dateLabel(invoice.due)}</td><td className="amount-cell">{money(invoice.amount)}</td></tr>; })}</tbody></table></div>}
    <footer className="table-footer"><span>Showing <b>{invoices.length}</b> records</span><span>Click a row to view details</span></footer>
  </section>;
}
function Field({ label, full = false, children }) { return <label className={"field" + (full ? " form-full" : "")}><span>{label}</span>{children}</label>; }
function Detail({ label, value }) { return <div><small>{label}</small><b>{value}</b></div>; }

export default App;
