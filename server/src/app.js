import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { AuditEvent, AuthAttempt, Invitation, Invoice, InvoiceEvidence, LegalEntity, Organization, Portal, Session, SetupLock, TrackedDocument, User } from "./models.js";

const app = express();
const scrypt = promisify(scryptCallback);
const COOKIE = "portal_ledger_session";
const SESSION_MS = 7 * 86400000;
const ATTEMPT_WINDOW = 15 * 60000;
let databaseInitialization;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    const expected = process.env.CLIENT_ORIGIN;
    if (!origin || origin === expected) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "2mb" }));

function verifyOrigin(req, res, next) {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  const sameOrigin = origin && origin === `${req.protocol}://${req.get("host")}`;
  if (!sameOrigin && origin !== process.env.CLIENT_ORIGIN) return res.status(403).json({ error: "Request origin could not be verified." });
  next();
}
app.use("/api", verifyOrigin);

const hash = value => createHash("sha256").update(value).digest("hex");
const emailOf = value => String(value || "").trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const publicUser = (user, workspaceName = "") => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role,
  organizationId: String(user.organizationId), workspaceName,
});

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    try { out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return out;
}
function setCookie(res, token, clear = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const age = clear ? 0 : Math.floor(SESSION_MS / 1000);
  res.setHeader("Set-Cookie", `${COOKIE}=${clear ? "" : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`);
}
async function issueSession(user, res) {
  const token = randomBytes(32).toString("base64url");
  await Session.create({ tokenHash: hash(token), userId: user._id, organizationId: user.organizationId, expiresAt: new Date(Date.now() + SESSION_MS) });
  setCookie(res, token);
}
async function authLimiter(req, res, next) {
  const ip = String(req.ip || "unknown");
  const keys = [hash(`${ip}|${emailOf(req.body?.email || "setup")}`), hash(`${ip}|all`)];
  const count = await AuthAttempt.countDocuments({ keyHash: { $in: keys }, createdAt: { $gte: new Date(Date.now() - ATTEMPT_WINDOW) } });
  if (count >= 20) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  await AuthAttempt.insertMany(keys.map(keyHash => ({ keyHash, expiresAt: new Date(Date.now() + 86400000) })));
  next();
}
async function requireAuth(req, res, next) {
  const token = cookies(req)[COOKIE];
  if (!token || token.length > 200) return res.status(401).json({ error: "Sign in to continue." });
  const session = await Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } }).lean();
  if (!session) {
    setCookie(res, "", true);
    return res.status(401).json({ error: "Your session expired. Sign in again." });
  }
  const user = await User.findById(session.userId).lean();
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    setCookie(res, "", true);
    return res.status(401).json({ error: "This session is no longer active." });
  }
  req.user = { id: String(user._id), organizationId: user.organizationId, role: user.role, name: user.name, email: user.email };
  next();
}
function role(...allowed) {
  return (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "Your workspace role does not allow this action." });
}
async function audit(req, action, entityType, entityId, summary) {
  await AuditEvent.create({ organizationId: req.user.organizationId, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, action, entityType, entityId: String(entityId || "").slice(0, 64), summary: String(summary).slice(0, 240) });
}

export async function initializeDatabase() {
  databaseInitialization ??= (async () => {
    for (const [model, index] of [[Invoice, "client_1_number_1"], [Portal, "name_1"]]) {
      try { await model.collection.dropIndex(index); }
      catch (error) { if (error.code !== 27 && error.codeName !== "IndexNotFound" && error.codeName !== "NamespaceNotFound") throw error; }
    }
    await Promise.all([Organization, User, Session, Invitation, AuthAttempt, SetupLock, AuditEvent, LegalEntity, InvoiceEvidence, Invoice, Portal, TrackedDocument].map(model => model.createIndexes()));
    await SetupLock.updateOne({ key: "initial-owner" }, { $setOnInsert: { key: "initial-owner" } }, { upsert: true });
    const organizations = await Organization.find({}).select("_id").lean();
    for (const organization of organizations) {
      let entity = await LegalEntity.findOne({ organizationId: organization._id, isDefault: true });
      if (!entity) entity = await LegalEntity.findOneAndUpdate({ organizationId: organization._id, name: "Primary entity" },
        { $setOnInsert: { organizationId: organization._id, name: "Primary entity", currency: "EUR", isDefault: true } },
        { new: true, upsert: true, setDefaultsOnInsert: true });
      await Invoice.updateMany({ organizationId: organization._id, entityId: { $exists: false } }, { $set: { entityId: entity._id, currency: entity.currency || "EUR" } });
    }
  })().catch(error => { databaseInitialization = undefined; throw error; });
  return databaseInitialization;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));
app.get("/api/auth/setup-status", async (_req, res) => res.json({ data: { setupRequired: !(await User.exists({})) } }));

app.post("/api/auth/register", authLimiter, async (req, res) => {
  if (await User.exists({})) return res.status(403).json({ error: "Workspace setup is already complete. Ask an admin for an invitation." });
  const provided = Buffer.from(String(req.body?.setupKey || ""));
  const configured = Buffer.from(String(process.env.PORTAL_LEDGER_SETUP_KEY || ""));
  if (!configured.length || provided.length !== configured.length || !timingSafeEqual(provided, configured)) return res.status(403).json({ error: "The one-time setup code is invalid." });
  const name = String(req.body?.name || "").trim();
  const email = emailOf(req.body?.email);
  const password = String(req.body?.password || "");
  const workspaceName = String(req.body?.workspaceName || `${name}'s Workspace`).trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Use a password between 12 and 128 characters." });
  if (!workspaceName || workspaceName.length > 120) return res.status(400).json({ error: "Workspace name must be 1 to 120 characters." });
  const lock = await SetupLock.findOneAndUpdate(
    { key: "initial-owner", completedAt: null, $or: [{ claimedAt: null }, { claimExpiresAt: { $lt: new Date() } }] },
    { $set: { claimedAt: new Date(), claimExpiresAt: new Date(Date.now() + 5 * 60000) } },
    { new: true }
  );
  if (!lock) return res.status(403).json({ error: "Workspace setup is already complete or being claimed." });
  let organization, user;
  try {
    const salt = randomBytes(16).toString("hex");
    const derived = Buffer.from(await scrypt(password, salt, 64)).toString("hex");
    organization = await Organization.create({ name: workspaceName });
    user = await User.create({ name, email, passwordHash: `${salt}:${derived}`, organizationId: organization._id, role: "owner" });
    await Promise.all([
      Invoice.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId: organization._id } }),
      Portal.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId: organization._id } }),
      TrackedDocument.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId: organization._id } }),
    ]);
    lock.completedAt = new Date();
    lock.claimExpiresAt = null;
    await lock.save();
    await issueSession(user, res);
    return res.status(201).json({ data: { user: publicUser(user, organization.name) } });
  } catch (error) {
    if (lock && !lock.completedAt) { lock.claimedAt = null; lock.claimExpiresAt = null; await lock.save(); }
    if (user) await User.deleteOne({ _id: user._id });
    if (organization) await Organization.deleteOne({ _id: organization._id });
    if (error.code === 11000) return res.status(409).json({ error: "That email is already registered." });
    throw error;
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = emailOf(req.body?.email);
  const password = String(req.body?.password || "");
  if (!validEmail(email) || password.length > 128) return res.status(401).json({ error: "Email or password is incorrect." });
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) return res.status(401).json({ error: "Email or password is incorrect." });
  const [salt, savedHex] = user.passwordHash.split(":");
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const saved = Buffer.from(savedHex, "hex");
  if (saved.length !== actual.length || !timingSafeEqual(saved, actual)) return res.status(401).json({ error: "Email or password is incorrect." });
  await issueSession(user, res);
  const org = await Organization.findById(user.organizationId).lean();
  res.json({ data: { user: publicUser(user, org?.name || "") } });
});

app.post("/api/auth/invitations/accept", authLimiter, async (req, res) => {
  const token = String(req.body?.token || "");
  const name = String(req.body?.name || "").trim();
  const password = String(req.body?.password || "");
  if (token.length < 24 || token.length > 200) return res.status(400).json({ error: "This invitation is invalid or expired." });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Use a password between 12 and 128 characters." });
  const invitation = await Invitation.findOne({ tokenHash: hash(token), acceptedAt: null, expiresAt: { $gt: new Date() } });
  if (!invitation) return res.status(400).json({ error: "This invitation is invalid, expired, or already used." });
  if (await User.exists({ email: invitation.email })) return res.status(409).json({ error: "This email already has an account. Ask an admin to update the invitation." });
  const organization = await Organization.findById(invitation.organizationId);
  if (!organization) return res.status(400).json({ error: "The workspace no longer exists." });
  const salt = randomBytes(16).toString("hex");
  const derived = Buffer.from(await scrypt(password, salt, 64)).toString("hex");
  const user = await User.create({ name, email: invitation.email, passwordHash: `${salt}:${derived}`, organizationId: invitation.organizationId, role: invitation.role });
  invitation.acceptedAt = new Date();
  await invitation.save();
  await issueSession(user, res);
  res.status(201).json({ data: { user: publicUser(user, organization.name) } });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = cookies(req)[COOKIE];
  if (token) await Session.deleteOne({ tokenHash: hash(token) });
  setCookie(res, "", true);
  res.json({ data: { ok: true } });
});

app.use("/api", requireAuth);
app.get("/api/auth/me", async (req, res) => {
  const org = await Organization.findById(req.user.organizationId).lean();
  res.json({ data: { user: { ...req.user, workspaceName: org?.name || "" } } });
});
app.post("/api/auth/change-password", authLimiter, async (req, res) => {
  const user = await User.findById(req.user.id).select("+passwordHash");
  const currentPassword = String(req.body?.currentPassword || "");
  const nextPassword = String(req.body?.newPassword || "");
  if (nextPassword.length < 12 || nextPassword.length > 128) return res.status(400).json({ error: "Use a password between 12 and 128 characters." });
  const [salt, savedHex] = user.passwordHash.split(":");
  const actual = Buffer.from(await scrypt(currentPassword, salt, 64));
  const saved = Buffer.from(savedHex, "hex");
  if (saved.length !== actual.length || !timingSafeEqual(saved, actual)) return res.status(400).json({ error: "Current password is incorrect." });
  const newSalt = randomBytes(16).toString("hex");
  user.passwordHash = `${newSalt}:${Buffer.from(await scrypt(nextPassword, newSalt, 64)).toString("hex")}`;
  await user.save();
  await Session.deleteMany({ userId: user._id });
  await issueSession(user, res);
  await audit(req, "auth.password.changed", "security", user._id, "Password changed; other sessions were revoked");
  res.json({ data: { changed: true } });
});

app.get("/api/entities", async (req, res) => {
  res.json({ data: await LegalEntity.find({ organizationId: req.user.organizationId }).sort({ isDefault: -1, name: 1 }).lean() });
});
app.post("/api/entities", role("owner", "admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim(), country = String(req.body?.country || "").trim();
  const currency = String(req.body?.currency || "EUR").toUpperCase();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Entity name must be 2 to 120 characters." });
  if (!["EUR", "USD", "GBP", "CHF", "CAD"].includes(currency)) return res.status(400).json({ error: "Choose a supported currency." });
  const entity = await LegalEntity.create({ organizationId: req.user.organizationId, name, country, currency });
  await audit(req, "entity.created", "entity", entity._id, `Legal entity ${entity.name} added (${currency})`);
  res.status(201).json({ data: entity });
});
app.get("/api/audit", role("owner", "admin"), async (req, res) => {
  const parsed = Number.parseInt(String(req.query.limit || "40"), 10);
  const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 40, 1), 100);
  const filter = { organizationId: req.user.organizationId };
  if (req.query.before) {
    const before = new Date(String(req.query.before));
    if (Number.isNaN(before.getTime())) return res.status(400).json({ error: "The activity cursor is invalid." });
    filter.createdAt = { $lt: before };
  }
  const rows = await AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit, events = rows.slice(0, limit);
  res.json({ data: { events, hasMore, nextCursor: hasMore ? events[events.length - 1].createdAt.toISOString() : null } });
});

app.get("/api/invoices", async (req, res) => {
  const { q = "", status = "" } = req.query;
  const filter = { organizationId: req.user.organizationId };
  if (status && status !== "all") filter.status = status;
  if (q) {
    const escaped = String(q).replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{ number: expression }, { client: expression }, { portal: expression }, { reference: expression }];
  }
  if (req.query.entityId) filter.entityId = String(req.query.entityId);
  if (req.query.currency) filter.currency = String(req.query.currency).toUpperCase();
  res.json({ data: await Invoice.find(filter).sort({ due: 1, createdAt: -1 }).lean() });
});
app.post("/api/invoices", role("owner", "admin", "accountant"), async (req, res) => {
  const allowed = ["number", "client", "amount", "currency", "entityId", "portal", "submitted", "due", "status", "reference", "note", "rejectionReason", "assignedTo", "followUpAt", "expectedPaymentDate"];
  const payload = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
  payload.organizationId = req.user.organizationId;
  const entity = payload.entityId ? await LegalEntity.findOne({ _id: payload.entityId, organizationId: req.user.organizationId }) : await LegalEntity.findOne({ organizationId: req.user.organizationId, isDefault: true });
  if (!entity) return res.status(400).json({ error: "Choose a legal entity in this workspace." });
  payload.entityId = entity._id; payload.currency ||= entity.currency || "EUR";
  const invoice = await Invoice.create(payload);
  await Portal.updateOne(
    { organizationId: req.user.organizationId, name: invoice.portal },
    { $setOnInsert: { organizationId: req.user.organizationId, name: invoice.portal } }, { upsert: true }
  );
  await audit(req, "invoice.created", "invoice", invoice._id, `Invoice ${invoice.number} created for ${invoice.client}`);
  res.status(201).json({ data: invoice });
});
app.patch("/api/invoices/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const allowed = ["status", "note", "reference", "due", "submitted", "rejectionReason", "assignedTo", "followUpAt", "expectedPaymentDate", "currency", "entityId"];
  const update = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
  if (update.entityId && !await LegalEntity.exists({ _id: update.entityId, organizationId: req.user.organizationId })) return res.status(400).json({ error: "Choose a legal entity in this workspace." });
  if (update.assignedTo && !await User.exists({ _id: update.assignedTo, organizationId: req.user.organizationId })) return res.status(400).json({ error: "Choose a workspace team member." });
  if (update.status === "Paid") update.paidAt = new Date().toISOString().slice(0, 10);
  if (update.status && update.status !== "Paid") update.paidAt = "";
  const invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, organizationId: req.user.organizationId }, update, { new: true, runValidators: true });
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  const fields = Object.keys(update).filter(key => key !== "paidAt");
  await audit(req, update.status === "Paid" ? "invoice.paid" : "invoice.updated", "invoice", invoice._id,
    update.status === "Paid" ? `Invoice ${invoice.number} marked paid` : `Invoice ${invoice.number} updated (${fields.join(", ") || "details"})`);
  res.json({ data: invoice });
});
app.delete("/api/invoices/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  await audit(req, "invoice.deleted", "invoice", invoice._id, `Invoice ${invoice.number} deleted`);
  res.status(204).end();
});

app.get("/api/invoices/:id/evidence", async (req, res) => {
  if (!await Invoice.exists({ _id: req.params.id, organizationId: req.user.organizationId })) return res.status(404).json({ error: "Invoice not found." });
  const files = await InvoiceEvidence.find({ invoiceId: req.params.id, organizationId: req.user.organizationId }).select("-data").sort({ createdAt: -1 }).lean();
  res.json({ data: files });
});
app.post("/api/invoices/:id/evidence", role("owner", "admin", "accountant"), async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, organizationId: req.user.organizationId }).select("number");
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  const name = String(req.body?.name || "").split(/[\\/]/).pop().trim().slice(0, 160);
  const mimeType = String(req.body?.mimeType || ""), encoded = String(req.body?.data || "");
  if (!name || !["application/pdf", "image/png", "image/jpeg"].includes(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return res.status(400).json({ error: "Attach a PDF, PNG, or JPEG file." });
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > 1200000 || data.toString("base64") !== encoded) return res.status(413).json({ error: "Evidence files must be smaller than 1.2 MB." });
  const file = await InvoiceEvidence.create({ organizationId: req.user.organizationId, invoiceId: req.params.id, uploadedBy: req.user.id, name, mimeType, size: data.length, data });
  await audit(req, "invoice.evidence.added", "invoice", invoice._id, `Evidence attached to invoice ${invoice.number}`);
  res.status(201).json({ data: { _id: file._id, name, mimeType, size: file.size, createdAt: file.createdAt } });
});
app.get("/api/invoices/:id/evidence/:evidenceId", async (req, res) => {
  const file = await InvoiceEvidence.findOne({ _id: req.params.evidenceId, invoiceId: req.params.id, organizationId: req.user.organizationId }).select("+data");
  if (!file) return res.status(404).json({ error: "Evidence file not found." });
  const safeName = file.name.replace(/["\\\r\n]/g, "_");
  res.set({ "Content-Type": file.mimeType, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename="${safeName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.send(file.data);
});
app.delete("/api/invoices/:id/evidence/:evidenceId", role("owner", "admin", "accountant"), async (req, res) => {
  const file = await InvoiceEvidence.findOneAndDelete({ _id: req.params.evidenceId, invoiceId: req.params.id, organizationId: req.user.organizationId });
  if (!file) return res.status(404).json({ error: "Evidence file not found." });
  await audit(req, "invoice.evidence.deleted", "invoice", req.params.id, "Evidence removed from invoice");
  res.status(204).end();
});
app.get("/api/portals", async (req, res) => res.json({ data: await Portal.find({ organizationId: req.user.organizationId }).sort({ name: 1 }).lean() }));
app.post("/api/portals", role("owner", "admin", "accountant"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const url = String(req.body?.url || "").trim();
  const requirements = String(req.body?.requirements || "").trim();
  const paymentTermsDays = Number(req.body?.paymentTermsDays ?? 30);
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) return res.status(400).json({ error: "Payment terms must be between 0 and 365 days." });
  const portal = await Portal.create({ organizationId: req.user.organizationId, name, url, requirements, paymentTermsDays });
  await audit(req, "portal.created", "portal", portal._id, `Portal shortcut “${portal.name}” created`);
  res.status(201).json({ data: portal });
});
app.patch("/api/portals/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const portal = await Portal.findOneAndUpdate({ _id: req.params.id, organizationId: req.user.organizationId }, { name: req.body?.name, url: req.body?.url, requirements: req.body?.requirements, paymentTermsDays: req.body?.paymentTermsDays }, { new: true, runValidators: true });
  if (!portal) return res.status(404).json({ error: "Portal not found." });
  await audit(req, "portal.updated", "portal", portal._id, `Portal shortcut “${portal.name}” updated`);
  res.json({ data: portal });
});
app.delete("/api/portals/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const portal = await Portal.findOneAndDelete({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!portal) return res.status(404).json({ error: "Portal not found." });
  await audit(req, "portal.deleted", "portal", portal._id, `Portal shortcut “${portal.name}” deleted`);
  res.status(204).end();
});

app.get("/api/documents", async (req, res) => res.json({ data: await TrackedDocument.find({ organizationId: req.user.organizationId }).sort({ expiresAt: 1 }).lean() }));
app.post("/api/documents", role("owner", "admin", "accountant"), async (req, res) => {
  const document = await TrackedDocument.create({
    organizationId: req.user.organizationId, name: String(req.body?.name || "").trim(),
    category: req.body?.category || "Other", expiresAt: req.body?.expiresAt,
  });
  await audit(req, "document.created", "document", document._id, `Renewal reminder “${document.name}” created`);
  res.status(201).json({ data: document });
});
app.patch("/api/documents/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const document = await TrackedDocument.findOneAndUpdate({ _id: req.params.id, organizationId: req.user.organizationId },
    { name: req.body?.name, category: req.body?.category, expiresAt: req.body?.expiresAt }, { new: true, runValidators: true });
  if (!document) return res.status(404).json({ error: "Document not found." });
  await audit(req, "document.updated", "document", document._id, `Renewal reminder “${document.name}” updated`);
  res.json({ data: document });
});
app.delete("/api/documents/:id", role("owner", "admin", "accountant"), async (req, res) => {
  const doc = await TrackedDocument.findOneAndDelete({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!doc) return res.status(404).json({ error: "Document not found." });
  await audit(req, "document.deleted", "document", doc._id, `Renewal reminder “${doc.name}” deleted`);
  res.status(204).end();
});

app.get("/api/team/members", role("owner", "admin"), async (req, res) => {
  const users = await User.find({ organizationId: req.user.organizationId }).sort({ role: 1, name: 1 }).lean();
  res.json({ data: users.map(user => ({ id: String(user._id), name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })) });
});
app.get("/api/team/invitations", role("owner", "admin"), async (req, res) => {
  const rows = await Invitation.find({ organizationId: req.user.organizationId, acceptedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
  res.json({ data: rows.map(row => ({ id: String(row._id), email: row.email, role: row.role, expiresAt: row.expiresAt })) });
});
app.post("/api/team/invitations", role("owner", "admin"), async (req, res) => {
  const email = emailOf(req.body?.email);
  const inviteRole = String(req.body?.role || "viewer");
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!["admin", "accountant", "viewer"].includes(inviteRole)) return res.status(400).json({ error: "Choose a valid team role." });
  if (req.user.role === "admin" && inviteRole === "admin") return res.status(403).json({ error: "Only the owner can invite admins." });
  if (await User.exists({ email })) return res.status(409).json({ error: "This email already has an account." });
  await Invitation.deleteMany({ organizationId: req.user.organizationId, email, acceptedAt: null });
  const token = randomBytes(32).toString("base64url");
  const invite = await Invitation.create({
    tokenHash: hash(token), email, role: inviteRole, organizationId: req.user.organizationId,
    createdBy: req.user.id, expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  const base = process.env.APP_ORIGIN || process.env.CLIENT_ORIGIN || `${req.protocol}://${req.get("host")}`;
  const url = new URL("/", base);
  url.searchParams.set("invite", token);
  await audit(req, "team.invitation.created", "team", invite._id, `Invitation created for ${email} as ${inviteRole}`);
  res.status(201).json({ data: { id: String(invite._id), email, role: inviteRole, expiresAt: invite.expiresAt, inviteUrl: url.toString() } });
});
app.patch("/api/team/members/:id/role", role("owner", "admin"), async (req, res) => {
  const nextRole = String(req.body?.role || "");
  if (!["admin", "accountant", "viewer"].includes(nextRole)) return res.status(400).json({ error: "Choose a valid role." });
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot change your own role." });
  const member = await User.findOne({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!member) return res.status(404).json({ error: "Team member not found." });
  if (member.role === "owner") return res.status(403).json({ error: "The owner role cannot be changed." });
  if (req.user.role === "admin" && (member.role === "admin" || nextRole === "admin")) return res.status(403).json({ error: "Admins can manage accountants and viewers only." });
  const previousRole = member.role;
  member.role = nextRole;
  await member.save();
  await audit(req, "team.role.changed", "team", member._id, `${member.name} changed from ${previousRole} to ${nextRole}`);
  res.json({ data: { id: String(member._id), name: member.name, email: member.email, role: member.role } });
});
app.delete("/api/team/members/:id", role("owner", "admin"), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot remove your own account." });
  const member = await User.findOne({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!member) return res.status(404).json({ error: "Team member not found." });
  if (member.role === "owner") return res.status(403).json({ error: "The owner cannot be removed." });
  if (req.user.role === "admin" && member.role === "admin") return res.status(403).json({ error: "Admins cannot remove another admin." });
  await Promise.all([Session.deleteMany({ userId: member._id }), User.deleteOne({ _id: member._id })]);
  await audit(req, "team.member.removed", "team", member._id, `${member.name} removed from the workspace`);
  res.status(204).end();
});
app.delete("/api/team/invitations/:id", role("owner", "admin"), async (req, res) => {
  const invite = await Invitation.findOneAndDelete({ _id: req.params.id, organizationId: req.user.organizationId, acceptedAt: null });
  if (!invite) return res.status(404).json({ error: "Invitation not found." });
  await audit(req, "team.invitation.revoked", "team", invite._id, `Invitation for ${invite.email} revoked`);
  res.status(204).end();
});

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` }));
app.use((error, _req, res, _next) => {
  if (error?.code === 11000) return res.status(409).json({ error: "A record with that value already exists." });
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) return res.status(400).json({ error: error.message });
  if (error.message === "Cross-origin request blocked.") return res.status(403).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Check the server log for details." });
});
export default app;
