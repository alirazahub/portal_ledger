import { useCallback, useEffect, useMemo, useState } from "react";

const money = (value, currency = "EUR") => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
const moneyByCurrency = (items) => {
  const totals = items.reduce((all, item) => { const c = item.currency || "EUR"; all[c] = (all[c] || 0) + Number(item.amount || 0); return all; }, {});
  return Object.entries(totals).map(([c, total]) => money(total, c)).join(" · ") || money(0);
};
const currencies = ["EUR", "USD", "GBP", "CHF", "CAD"];
const dateLabel = (value) => value ? new Date(value + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dayDelta = (value) => {
  if (!value) return 0;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
};
const initials = (value = "") => value.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
const effectiveStatus = (invoice) => invoice.status !== "Paid" && invoice.status !== "Draft" && !["Rejected", "Needs info"].includes(invoice.status) && dayDelta(invoice.due) < 0 ? "Overdue" : invoice.status;
const addDays = (value, days) => { if (!value) return ""; const [y, m, d] = value.slice(0, 10).split("-").map(Number); const date = new Date(y, m - 1, d + Number(days || 0)); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); };
const estimatedPaymentDate = (invoice, portals) => invoice.expectedPaymentDate || addDays(invoice.submitted, portals.find(p => p.name === invoice.portal)?.paymentTermsDays ?? 30);

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
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const inviteToken = new URLSearchParams(window.location.search).get("invite") || "";

  useEffect(() => {
    let active = true;
    request("/auth/me")
      .then((data) => { if (active) setUser(data.user); })
      .catch(async (error) => {
        if (!active) return;
        if (/sign in|session expired|no longer active/i.test(error.message)) {
          try {
            const status = await request("/auth/setup-status");
            if (active) setSetupRequired(status.setupRequired);
          } catch (statusError) { if (active) setAuthError(statusError.message); }
        } else {
          setAuthError(error.message);
        }
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    try { await request("/auth/logout", { method: "POST", body: "{}" }); } catch {}
    setUser(null);
  }

  if (checking) return <div className="auth-loading">Opening your secure workspace…</div>;
  if (!user) return <AuthScreen setupRequired={setupRequired} inviteToken={inviteToken} initialError={authError} onAuthenticated={(nextUser) => {
    window.history.replaceState({}, "", window.location.pathname);
    setAuthError("");
    setUser(nextUser);
  }} />;
  return <WorkspaceApp user={user} onLogout={signOut} />;
}

function AuthScreen({ setupRequired, inviteToken, initialError, onAuthenticated }) {
  const [mode, setMode] = useState(inviteToken ? "invite" : setupRequired ? "setup" : "login");
  const [error, setError] = useState(initialError || "");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let data;
      if (mode === "invite") data = await request("/auth/invitations/accept", { method: "POST", body: JSON.stringify({ ...values, token: inviteToken }) });
      else if (mode === "setup") data = await request("/auth/register", { method: "POST", body: JSON.stringify(values) });
      else data = await request("/auth/login", { method: "POST", body: JSON.stringify(values) });
      onAuthenticated(data.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const heading = mode === "setup" ? "Create your workspace" : mode === "invite" ? "Join your team" : "Welcome back";
  const description = mode === "setup"
    ? "Set up the owner account. This one-time code is required before the workspace can be claimed."
    : mode === "invite" ? "Accept your invitation and create your account." : "Sign in to continue to Portal Ledger.";

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand auth-brand"><span className="brand-mark">P</span><span><b>Portal Ledger</b><small>Private supplier workspace</small></span></div>
      <div className="auth-copy"><div className="eyebrow">{mode === "invite" ? "TEAM INVITATION" : mode === "setup" ? "FIRST TIME SETUP" : "SECURE SIGN IN"}</div><h1>{heading}</h1><p>{description}</p></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="auth-form" onSubmit={submit}>
        {(mode === "setup" || mode === "invite") && <label className="field"><span>Your name</span><input name="name" autoComplete="name" minLength="2" maxLength="80" required /></label>}
        {mode !== "invite" && <label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" maxLength="254" required /></label>}
        {mode === "setup" && <label className="field"><span>Workspace name</span><input name="workspaceName" maxLength="120" placeholder="Your company" /></label>}
        {mode === "setup" && <label className="field"><span>One-time setup code</span><input name="setupKey" autoComplete="off" required /></label>}
        <label className="field"><span>Password {mode !== "login" && <small>(12 characters minimum)</small>}</span><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} maxLength="128" required /></label>
        <button className="button primary auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "invite" ? "Accept invitation" : "Create owner account"}</button>
      </form>
      <p className="auth-footnote">{mode === "setup" ? "The setup code can be used only once. After the owner is created, teammates join by invitation." : mode === "invite" ? "Invitation links expire after seven days and can be used once." : "Ask your workspace owner or admin for an invitation if you need access."}</p>
    </section>
  </main>;
}

function TeamManager({ user }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [memberRows, inviteRows] = await Promise.all([request("/team/members"), request("/team/invitations")]);
      setMembers(memberRows); setInvitations(inviteRows); setError("");
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function createInvite(event) {
    event.preventDefault(); setBusy(true); setError(""); setInviteUrl("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request("/team/invitations", { method: "POST", body: JSON.stringify(values) });
      setInviteUrl(result.inviteUrl); form.reset(); await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function updateRole(memberId, nextRole) {
    setBusy(true); setError("");
    try { await request("/team/members/" + memberId + "/role", { method: "PATCH", body: JSON.stringify({ role: nextRole }) }); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeMember(member) {
    if (!window.confirm("Remove " + member.name + " from this workspace? Their sessions will be revoked.")) return;
    try { await request("/team/members/" + member.id, { method: "DELETE" }); await refresh(); }
    catch (err) { setError(err.message); }
  }
  async function revokeInvite(invite) {
    try { await request("/team/invitations/" + invite.id, { method: "DELETE" }); await refresh(); }
    catch (err) { setError(err.message); }
  }
  const options = user.role === "owner" ? ["admin", "accountant", "viewer"] : ["accountant", "viewer"];

  return <div className="team-layout">
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel team-panel">
      <div className="panel-header"><div><b>Invite a teammate</b><small>Invitation links are single use and expire in seven days.</small></div></div>
      <form className="team-invite-form" onSubmit={createInvite}>
        <label className="field"><span>Email address</span><input name="email" type="email" maxLength="254" required /></label>
        <label className="field"><span>Role</span><select name="role" defaultValue="accountant">{options.map(roleName => <option key={roleName} value={roleName}>{roleName}</option>)}</select></label>
        <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create invite link"}</button>
      </form>
      {inviteUrl && <div className="invite-link-box"><div><b>Invitation link ready</b><small>Share this link with the invited teammate.</small><code>{inviteUrl}</code></div><button className="button" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy link</button></div>}
    </section>
    <section className="panel team-panel">
      <div className="panel-header"><div><b>Workspace members</b><small>Viewer can read and export. Accountant can manage records. Admin manages members and records.</small></div></div>
      <div className="team-list">{members.map(member => <div className="team-row" key={member.id}><span className="user-avatar">{initials(member.name)}</span><span className="team-person"><b>{member.name}{member.id === user.id ? " (you)" : ""}</b><small>{member.email}</small></span><span className={"role-badge role-" + member.role}>{member.role}</span>{member.role !== "owner" && <><select aria-label={"Role for " + member.name} value={member.role} disabled={busy || (user.role === "admin" && member.role === "admin")} onChange={event => updateRole(member.id, event.target.value)}>{options.map(roleName => <option key={roleName}>{roleName}</option>)}</select><button className="button danger-quiet" disabled={busy || (user.role === "admin" && member.role === "admin")} onClick={() => removeMember(member)}>Remove</button></>}</div>)}</div>
    </section>
    <section className="panel team-panel">
      <div className="panel-header"><div><b>Pending invitations</b><small>Revoke an invite if it was sent to the wrong person.</small></div></div>
      {!invitations.length ? <Empty text="No pending invitations." /> : <div className="team-list">{invitations.map(invite => <div className="team-row" key={invite.id}><span className="team-person"><b>{invite.email}</b><small>{invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></span><button className="button danger-quiet" onClick={() => revokeInvite(invite)}>Revoke</button></div>)}</div>}
    </section>
  </div>;
}

function AuditLog() {
  const [events, setEvents] = useState([]), [cursor, setCursor] = useState(null), [more, setMore] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState("");
  async function load(reset = false) {
    setBusy(true); setError("");
    const before = reset ? null : cursor;
    try {
      const result = await request("/audit?limit=40" + (before ? "&before=" + encodeURIComponent(before) : ""));
      setEvents(current => before ? [...current, ...result.events] : result.events);
      setCursor(result.nextCursor); setMore(result.hasMore);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(true); }, []);
  return <section className="panel audit-panel">
    <div className="panel-header"><div><b>Workspace activity</b><small>Changes from the last 12 months</small></div><button className="button" disabled={busy} onClick={() => load(true)}>Refresh</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!events.length && !busy ? <Empty text="No workspace activity has been recorded yet." /> : <div className="audit-list">{events.map(event => <article className="audit-row" key={event._id}>
      <span className="audit-mark" aria-hidden="true">{event.entityType === "security" ? "⌑" : event.entityType === "team" ? "♙" : "↻"}</span>
      <span className="audit-copy"><b>{event.summary}</b><small>{event.actorName} · {event.actorRole} · {event.entityType}</small></span>
      <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
    </article>)}</div>}
    {busy && <div className="loading-card">Loading activity…</div>}
    {!busy && more && <div className="audit-more"><button className="button" onClick={() => load()}>Load older activity</button></div>}
  </section>;
}

function EntityManager() {
  const [entities, setEntities] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() { try { setEntities(await request("/entities")); setError(""); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, []);
  async function add(event) {
    event.preventDefault(); setBusy(true); setError(""); const form = event.currentTarget;
    try { await request("/entities", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); form.reset(); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="team-layout">{error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel team-panel"><div className="panel-header"><div><b>Add legal entity</b><small>Separate invoices by company and base currency.</small></div></div>
      <form className="team-invite-form" onSubmit={add}><label className="field"><span>Entity name</span><input name="name" minLength="2" maxLength="120" required placeholder="Company SAS" /></label>
      <label className="field"><span>Country</span><input name="country" maxLength="80" placeholder="France" /></label>
      <label className="field"><span>Base currency</span><select name="currency">{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
      <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Add entity"}</button></form>
    </section><section className="panel team-panel"><div className="panel-header"><div><b>Legal entities</b><small>Invoices retain their recorded currency.</small></div></div>
      <div className="team-list">{entities.map(e => <div className="team-row" key={e._id}><span className="portal-icon">{e.isDefault ? "★" : "◇"}</span><span className="team-person"><b>{e.name}</b><small>{e.country || "Country not set"} · {e.currency}{e.isDefault ? " · default" : ""}</small></span></div>)}</div></section>
  </div>;
}

function InvoiceEvidence({ invoice, canWrite }) {
  const [files, setFiles] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() { try { setFiles(await request("/invoices/" + invoice._id + "/evidence")); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, [invoice._id]);
  async function upload(event) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 1200000) { setError("Choose a file smaller than 1.2 MB."); event.target.value = ""; return; }
    setBusy(true); setError("");
    try {
      const data = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = fail; r.readAsDataURL(file); });
      await request("/invoices/" + invoice._id + "/evidence", { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type, data }) }); await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); event.target.value = ""; }
  }
  async function download(file) {
    try { const r = await fetch("/api/invoices/" + invoice._id + "/evidence/" + file._id); if (!r.ok) throw Error("Download failed.");
      const url = URL.createObjectURL(await r.blob()), link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  }
  async function remove(file) { try { await request("/invoices/" + invoice._id + "/evidence/" + file._id, { method: "DELETE" }); await refresh(); } catch (err) { setError(err.message); } }
  return <section className="evidence-box"><div className="panel-header"><div><b>Invoice evidence</b><small>PDF, PNG, or JPEG · max 1.2 MB each</small></div>{canWrite && <label className="button file-pick">{busy ? "Uploading…" : "＋ Attach file"}<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={upload} disabled={busy} hidden /></label>}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}{!files.length ? <Empty text="No proof or invoice file attached." /> : files.map(file => <div className="evidence-row" key={file._id}><span>▧</span><button className="text-link" onClick={() => download(file)}>{file.name}</button><small>{Math.ceil(file.size/1024)} KB</small>{canWrite && <button className="button danger-quiet" onClick={() => remove(file)}>Remove</button>}</div>)}
  </section>;
}

function WorkspaceApp({ user, onLogout }) {
  const [page, setPage] = useState("overview");
  const [invoices, setInvoices] = useState([]);
  const [portals, setPortals] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const canWrite = user.role !== "viewer";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceRows, portalRows, documentRows, entityRows] = await Promise.all([
        request("/invoices"), request("/portals"), request("/documents"), request("/entities"),
      ]);
      setInvoices(invoiceRows); setPortals(portalRows); setDocuments(documentRows); setEntities(entityRows);
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
  const outstanding = moneyByCurrency(openInvoices);
  const dueSoonTotal = moneyByCurrency(dueSoon);
  const overdueTotal = moneyByCurrency(overdueInvoices);

  function notify(message) { setToast(message); }
  function navigate(target) { setPage(target); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function updateIssue(invoice, status) {
    const reason = window.prompt(status === "Rejected" ? "Why was this invoice rejected?" : "What information is missing?", invoice.rejectionReason || "");
    if (reason === null) return;
    const followUpAt = window.prompt("Follow-up date (YYYY-MM-DD)", invoice.followUpAt || "");
    if (followUpAt === null) return;
    request("/invoices/" + invoice._id, { method: "PATCH", body: JSON.stringify({ status, rejectionReason: reason, followUpAt, assignedTo: user.id }) })
      .then(async () => { setSelected(null); await refresh(); notify("Invoice added to the issue queue"); }).catch(err => setError(err.message));
  }
  async function resolveIssue(invoice) {
    try { await request("/invoices/" + invoice._id, { method: "PATCH", body: JSON.stringify({ status: "Submitted", rejectionReason: "", followUpAt: "" }) }); setSelected(null); await refresh(); notify("Invoice returned to submitted"); }
    catch (err) { setError(err.message); }
  }
  async function saveInvoice(event) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.amount = Number(payload.amount);
    payload.currency ||= entities.find(entity => entity._id === payload.entityId)?.currency || "EUR";
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
  async function changePassword(event) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await request("/auth/change-password", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
      setModal(""); notify("Password updated. Other sessions were signed out.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  function exportCsv() {
    const entityNames = Object.fromEntries(entities.map(e => [e._id, e.name]));
    const rows = [["Invoice", "Legal entity", "Currency", "Customer", "Portal", "Status", "Submitted", "Due", "Expected payment", "Amount", "Reference", "Note"],
      ...invoices.map(i => [i.number, entityNames[i.entityId] || "Primary entity", i.currency || "EUR", i.client, i.portal, effectiveStatus(i), i.submitted, i.due, i.expectedPaymentDate || "", i.amount, i.reference, i.note])];
    const csv = rows.map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "portal-ledger-accounting-export.csv"; link.click(); URL.revokeObjectURL(link.href);
    notify("Accounting-ready CSV exported");
  }

  const portalNames = [...new Set([...portals.map((p) => p.name), ...invoices.map((i) => i.portal)])];
  const followups = openInvoices.filter((i) => i.status !== "Draft").sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
  const forecastWeeks = Array.from({ length: 4 }, (_, index) => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + index * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const rows = openInvoices.filter(invoice => { const date = estimatedPaymentDate(invoice, portals); return date && date >= start.toISOString().slice(0, 10) && date < end.toISOString().slice(0, 10); });
    return { label: index === 0 ? "This week" : `Week ${index + 1}`, rows };
  });
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" });

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span><b>Portal Ledger</b><small>Supplier workspace</small></span></div>
      <p className="nav-label">Workspace</p>
      <nav className="nav-list" aria-label="Workspace">
        {[["overview", "◫", "Overview"], ["invoices", "▤", "Invoices"], ["portals", "↗", "Customer portals"], ["documents", "▧", "Documents"], ...(user.role === "owner" || user.role === "admin" ? [["team", "♙", "Team"], ["entities", "◈", "Entities"], ["activity", "↻", "Activity log"]] : [])].map(([id, icon, label]) =>
          <button key={id} className={page === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}>
            <span className="nav-icon">{icon}</span><span>{label}</span>{id === "invoices" && <span className="nav-count">{openInvoices.length}</span>}
          </button>)}
      </nav>
      <div className="sidebar-bottom"><div className="workspace-note"><b>One clear picture</b><p>Keep invoice updates and portal links together.</p><div className="progress"><i /></div></div><div className="workspace-user"><span className="user-avatar">{initials(user.name)}</span><span><b>{user.workspaceName || "Workspace"}</b><small>{user.name} · {user.role}</small></span></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{page === "overview" ? "Overview" : page === "invoices" ? "Invoices" : page === "portals" ? "Customer portals" : page === "documents" ? "Documents" : page === "activity" ? "Activity log" : page === "entities" ? "Entities" : "Team"}</b></div>
        <div className="top-actions"><button className="button" onClick={() => setModal("security")}>Password</button><button className="button" onClick={onLogout}>Sign out</button><button className="button" onClick={exportCsv}>↓ Export</button>{canWrite && <button className="button primary" onClick={() => setModal("invoice")}>＋ New invoice</button>}</div>
      </header>
      <div className="content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {loading && <div className="loading-card">Connecting to your Portal Ledger API…</div>}
        {!loading && page === "overview" && <section>
          <div className="page-head"><div><div className="eyebrow">{today}</div><h1>Welcome, {user.name.split(" ")[0]}</h1><p>Here’s what needs attention across your customer portals.</p></div><div className="head-buttons"><button className="button" onClick={exportCsv}>↓ Export report</button>{canWrite && <button className="button primary" onClick={() => setModal("invoice")}>＋ Add invoice</button>}</div></div>
          <div className="stats-grid">
            <Stat label="Outstanding" value={outstanding} foot="Grouped by currency" icon="€" tone="green" />
            <Stat label="Due this week" value={dueSoonTotal} foot="Next 7 days · grouped by currency" icon="◷" tone="amber" />
            <Stat label="Overdue" value={overdueTotal} foot={overdueInvoices.length + " invoices · grouped by currency"} icon="!" tone="red" />
            <Stat label="Open invoices" value={openInvoices.length} foot={invoices.length - openInvoices.length + " paid this period"} icon="▤" tone="blue" />
          </div>
          <section className="panel forecast-panel"><div className="panel-header"><div><b>Expected cash collection</b><small>Estimated from portal payment terms unless an invoice date is set.</small></div><span className="pill pill-muted">Estimate only</span></div>
            <div className="forecast-grid">{forecastWeeks.map(week => <article className="forecast-card" key={week.label}><small>{week.label}</small><strong>{moneyByCurrency(week.rows)}</strong><span>{week.rows.length} invoice{week.rows.length === 1 ? "" : "s"}</span></article>)}</div>
          </section>
          <div className="dashboard-grid">
            <InvoicePanel invoices={filteredInvoices.slice(0, 6)} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={setSelected} />
            <div className="side-stack">
              <section className="panel side-panel"><div className="side-heading"><b>Portal activity</b><button className="text-link" onClick={() => navigate("portals")}>View all</button></div>
                {portalNames.slice(0, 4).map((name, index) => { const rows = invoices.filter((i) => i.portal === name && i.status !== "Paid"); return <div className="portal-row" key={name}><span className={"portal-icon tone-" + (index % 4)}>{initials(name)}</span><span className="portal-info"><b>{name}</b><small>{rows.length} open invoice{rows.length === 1 ? "" : "s"}</small></span><strong>{moneyByCurrency(rows)}</strong></div>; })}
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
          <p className="footnote">Only invited workspace members can access these records. Portal Ledger does not store portal passwords.</p>
        </section>}

        {!loading && page === "invoices" && <section>
          <div className="page-head"><div><div className="eyebrow">Receivables</div><h1>Invoices</h1><p>Track invoices submitted through each customer portal.</p></div><div className="head-buttons"><button className="button" onClick={exportCsv}>↓ Export</button>{canWrite && <button className="button primary" onClick={() => setModal("invoice")}>＋ Add invoice</button>}</div></div>
          <InvoicePanel invoices={filteredInvoices} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onSelect={setSelected} caption={invoices.length + " invoices · " + openInvoices.length + " open"} />
        </section>}

        {!loading && page === "portals" && <section>
          <div className="page-head"><div><div className="eyebrow">Customer access</div><h1>Customer portals</h1><p>Keep portal shortcuts beside invoice activity. Access is opened manually.</p></div><div className="head-buttons">{canWrite && <button className="button primary" onClick={() => setModal("portal")}>＋ Add portal</button>}</div></div>
          <div className="cards-grid">{portalNames.map((name, index) => { const portal = portals.find((p) => p.name === name); const rows = invoices.filter((i) => i.portal === name); const open = rows.filter((i) => i.status !== "Paid"); return <article className="portal-card" key={name}><div className="portal-card-head"><span className={"portal-icon tone-" + (index % 4)}>{initials(name)}</span><span className={"pill " + (portal?.url ? "pill-green" : "pill-muted")}>{portal?.url ? "Link saved" : "No link"}</span></div><h2>{name}</h2><p>{portal?.url ? "Shortcut saved" : "Add a URL for quick access"}</p>{portal && <div className="portal-guidance"><b>{portal.paymentTermsDays ?? 30}-day terms</b>{portal.requirements && <small>{portal.requirements}</small>}</div>}<div className="portal-metrics"><div><b>{rows.length}</b><small>Total</small></div><div><b>{moneyByCurrency(open)}</b><small>Outstanding</small></div><div><b>{rows.filter((i) => effectiveStatus(i) === "Overdue").length}</b><small>Overdue</small></div></div><div className="card-actions">{portal?.url ? <a className="button" href={portal.url} target="_blank" rel="noreferrer">↗ Open portal</a> : <button className="button" onClick={() => setModal("portal")}>＋ Add link</button>}<button className="button" onClick={() => navigate("invoices")}>Invoices</button></div></article>; })}</div>
          {!portalNames.length && <Empty text="Add an invoice or portal to get started." />}
          <p className="footnote">Portal Ledger never asks for portal credentials. Use links only for portals you’re authorized to access.</p>
        </section>}

        {!loading && page === "team" && <section><div className="page-head"><div><div className="eyebrow">Workspace access</div><h1>Team</h1><p>Invite people and assign access by role.</p></div></div><TeamManager user={user} /></section>}
        {!loading && page === "activity" && <section><div className="page-head"><div><div className="eyebrow">Workspace security</div><h1>Activity log</h1><p>Review who changed records and team access.</p></div></div><AuditLog /></section>}
        {!loading && page === "entities" && <section><div className="page-head"><div><div className="eyebrow">Company structure</div><h1>Entities & currencies</h1><p>Keep records separate by legal company and original invoice currency.</p></div></div><EntityManager /></section>}

        {!loading && page === "documents" && <section>
          <div className="page-head"><div><div className="eyebrow">Shared paperwork</div><h1>Documents</h1><p>Track renewal dates for documents customers may request.</p></div><div className="head-buttons">{canWrite && <button className="button primary" onClick={() => setModal("document")}>＋ Add document</button>}</div></div>
          <div className="cards-grid">{documents.map((doc) => <article className="document-card" key={doc._id}><div className="portal-card-head"><span className="document-icon">▧</span><span className={"pill " + (dayDelta(doc.expiresAt) <= 30 ? "pill-amber" : "pill-green")}>{dayDelta(doc.expiresAt) <= 30 ? "Renew soon" : "Active"}</span></div><h2>{doc.name}</h2><p>{doc.category}</p><div className="document-foot"><span>Renewal / expiry</span><b>{dateLabel(doc.expiresAt)}</b></div></article>)}</div>
          {!documents.length && <Empty text="No documents yet. Add a renewal date to track it here." />}
          <p className="footnote">This MVP stores document names and dates only. It does not upload files.</p>
        </section>}
      </div>
    </main>

    {modal === "security" && <Modal title="Change password" description="Choose a strong password of at least 12 characters." onClose={() => setModal("")}><form className="form-grid" onSubmit={changePassword}><Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required /></Field><Field label="New password" full><input name="newPassword" type="password" autoComplete="new-password" minLength="12" maxLength="128" required /></Field><div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Update password"}</button></div></form></Modal>}
    {modal === "invoice" && <Modal title="Add invoice" description="Record the customer portal and payment dates." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={saveInvoice}>
        <Field label="Invoice number"><input name="number" required maxLength="80" placeholder="INV-2026-014" /></Field>
        <Field label="Amount"><input name="amount" type="number" min="0.01" step="0.01" required placeholder="2400" /></Field>
        <Field label="Currency"><select name="currency" defaultValue={entities[0]?.currency || "EUR"}>{currencies.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Legal entity"><select name="entityId" defaultValue={entities[0]?._id || ""} required>{entities.map(e => <option key={e._id} value={e._id}>{e.name} · {e.currency}</option>)}</select></Field>
        <Field label="Customer"><input name="client" required maxLength="160" placeholder="Customer company" /></Field>
        <Field label="Portal"><input name="portal" list="portal-options" required maxLength="120" placeholder="Customer portal" /><datalist id="portal-options">{portalNames.map((name) => <option key={name} value={name} />)}</datalist></Field>
        <Field label="Submitted date"><input name="submitted" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
        <Field label="Due date"><input name="due" type="date" required /></Field>
        <Field label="Expected payment date"><input name="expectedPaymentDate" type="date" /></Field>
        <Field label="Status"><select name="status" defaultValue="Submitted"><option>Draft</option><option>Submitted</option><option>Approved</option><option>Processing</option></select></Field>
        <Field label="Portal reference"><input name="reference" maxLength="120" placeholder="Submission / PO reference" /></Field>
        <Field label="Note / next step" full><textarea name="note" maxLength="2000" placeholder="Rejection reason, AP contact, or next action" /></Field>
        <div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save invoice"}</button></div>
      </form>
    </Modal>}
    {modal === "portal" && <Modal title="Add portal shortcut" description="Save a URL for quick access. Portal passwords aren’t stored." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={savePortal}><Field label="Portal / customer name"><input name="name" required maxLength="160" placeholder="Customer portal" /></Field><Field label="Portal URL"><input name="url" type="url" pattern="https?://.+" required placeholder="https://portal.example.com" /></Field>
        <Field label="Typical payment terms (days)"><input name="paymentTermsDays" type="number" min="0" max="365" defaultValue="30" /></Field>
        <Field label="Submission requirements" full><textarea name="requirements" maxLength="2000" placeholder="PO number, timesheet, service period, required attachment…" /></Field><div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save portal"}</button></div></form>
    </Modal>}
    {modal === "document" && <Modal title="Add document reminder" description="Track the document name and renewal date. This MVP doesn’t upload files." onClose={() => setModal("")}>
      <form className="form-grid" onSubmit={saveDocument}><Field label="Document name"><input name="name" required maxLength="160" placeholder="Insurance certificate" /></Field><Field label="Renewal date"><input name="expiresAt" type="date" required /></Field><Field label="Category" full><select name="category"><option>Insurance</option><option>Registration</option><option>Tax document</option><option>Safety certificate</option><option>Other</option></select></Field><div className="modal-actions form-full"><button type="button" className="button" onClick={() => setModal("")}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save reminder"}</button></div></form>
    </Modal>}
    {selected && <Modal title={selected.number} description={selected.client + " · " + effectiveStatus(selected)} onClose={() => setSelected(null)}>
      <div className="detail-amount">{money(selected.amount, selected.currency || "EUR")}</div><div className="detail-grid">
        <Detail label="Customer portal" value={selected.portal} /><Detail label="Legal entity" value={entities.find(e => e._id === selected.entityId)?.name || "Primary entity"} /><Detail label="Portal reference" value={selected.reference || "Not recorded"} /><Detail label="Submitted" value={dateLabel(selected.submitted)} /><Detail label="Due date" value={dateLabel(selected.due)} />
      </div><div className="detail-note"><b>Latest note</b><p>{selected.note || "No note recorded."}</p></div>
      {(selected.status === "Rejected" || selected.status === "Needs info") && <div className="error-banner"><span><b>{selected.status}:</b> {selected.rejectionReason || "No reason recorded."}{selected.followUpAt ? " · Follow up " + dateLabel(selected.followUpAt) : ""}{selected.assignedTo === user.id ? " · Assigned to you" : ""}</span></div>}
      <InvoiceEvidence invoice={selected} canWrite={canWrite} />
      {canWrite && <div className="modal-actions"><button className="button" onClick={() => editNote(selected)}>＋ Add note</button>{!["Paid", "Rejected", "Needs info"].includes(selected.status) && <><button className="button" onClick={() => updateIssue(selected, "Needs info")}>Flag missing info</button><button className="button danger-quiet" onClick={() => updateIssue(selected, "Rejected")}>Mark rejected</button></>}{["Rejected", "Needs info"].includes(selected.status) && <button className="button primary" onClick={() => resolveIssue(selected)}>✓ Resubmit</button>}{selected.status !== "Paid" && <button className="button primary" onClick={() => markPaid(selected)}>✓ Mark paid</button>}</div>}
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
  return <section className="panel"><div className="panel-header"><div><b>Invoice activity</b><small>{caption || "Submissions, approvals, and payment status"}</small></div><div className="filter-row"><input aria-label="Search invoices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoices" /><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option>Submitted</option><option>Needs info</option><option>Rejected</option><option>Approved</option><option>Processing</option><option>Draft</option><option>Paid</option><option>Overdue</option></select></div></div>
    {!invoices.length ? <Empty text="No invoices match. Add an invoice to start tracking." /> : <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Portal</th><th>Status</th><th>Due date</th><th>Amount</th></tr></thead><tbody>{invoices.map((invoice) => { const status = effectiveStatus(invoice); const delta = dayDelta(invoice.due); return <tr key={invoice._id} onClick={() => onSelect(invoice)}><td><b>{invoice.number}</b><small>{invoice.reference || "No portal reference"}</small></td><td><div className="customer-cell"><span className="client-initials">{initials(invoice.client)}</span><span><b>{invoice.client}</b><small>Submitted {dateLabel(invoice.submitted)}</small></span></div></td><td><span className="portal-dot" />{invoice.portal}</td><td><span className={"status " + status.toLowerCase()}>{status}</span></td><td className={status === "Overdue" ? "text-red" : delta >= 0 && delta <= 7 && status !== "Paid" ? "text-amber" : ""}>{invoice.status === "Paid" ? "Paid" : status === "Overdue" ? Math.abs(delta) + "d overdue" : delta === 0 ? "Due today" : dateLabel(invoice.due)}</td><td className="amount-cell">{money(invoice.amount, invoice.currency || "EUR")}</td></tr>; })}</tbody></table></div>}
    <footer className="table-footer"><span>Showing <b>{invoices.length}</b> records</span><span>Click a row to view details</span></footer>
  </section>;
}
function Field({ label, full = false, children }) { return <label className={"field" + (full ? " form-full" : "")}><span>{label}</span>{children}</label>; }
function Detail({ label, value }) { return <div><small>{label}</small><b>{value}</b></div>; }

export default App;
