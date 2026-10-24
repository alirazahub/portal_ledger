import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { Invoice, Portal, TrackedDocument } from "./models.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

app.get("/api/invoices", async (req, res) => {
  const { q = "", status = "" } = req.query;
  const filter = {};
  if (status && status !== "all") filter.status = status;
  if (q) {
    const expression = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ number: expression }, { client: expression }, { portal: expression }, { reference: expression }];
  }
  const invoices = await Invoice.find(filter).sort({ due: 1, createdAt: -1 }).lean();
  res.json({ data: invoices });
});

app.post("/api/invoices", async (req, res) => {
  const invoice = await Invoice.create(req.body);
  if (invoice.portal) await Portal.updateOne({ name: invoice.portal }, { $setOnInsert: { name: invoice.portal } }, { upsert: true });
  res.status(201).json({ data: invoice });
});

app.patch("/api/invoices/:id", async (req, res) => {
  const allowed = ["status", "note", "reference", "due", "submitted"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.status === "Paid") update.paidAt = new Date().toISOString().slice(0, 10);
  if (update.status && update.status !== "Paid") update.paidAt = "";
  const invoice = await Invoice.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  res.json({ data: invoice });
});

app.delete("/api/invoices/:id", async (req, res) => {
  const invoice = await Invoice.findByIdAndDelete(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  res.status(204).end();
});

app.get("/api/portals", async (_req, res) => {
  res.json({ data: await Portal.find().sort({ name: 1 }).lean() });
});
app.post("/api/portals", async (req, res) => {
  res.status(201).json({ data: await Portal.create(req.body) });
});
app.patch("/api/portals/:id", async (req, res) => {
  const portal = await Portal.findByIdAndUpdate(req.params.id, { name: req.body.name, url: req.body.url }, { new: true, runValidators: true });
  if (!portal) return res.status(404).json({ error: "Portal not found." });
  res.json({ data: portal });
});
app.delete("/api/portals/:id", async (req, res) => {
  const portal = await Portal.findByIdAndDelete(req.params.id);
  if (!portal) return res.status(404).json({ error: "Portal not found." });
  res.status(204).end();
});

app.get("/api/documents", async (_req, res) => {
  res.json({ data: await TrackedDocument.find().sort({ expiresAt: 1 }).lean() });
});
app.post("/api/documents", async (req, res) => {
  res.status(201).json({ data: await TrackedDocument.create(req.body) });
});
app.patch("/api/documents/:id", async (req, res) => {
  const document = await TrackedDocument.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name, category: req.body.category, expiresAt: req.body.expiresAt },
    { new: true, runValidators: true }
  );
  if (!document) return res.status(404).json({ error: "Document not found." });
  res.json({ data: document });
});
app.delete("/api/documents/:id", async (req, res) => {
  const document = await TrackedDocument.findByIdAndDelete(req.params.id);
  if (!document) return res.status(404).json({ error: "Document not found." });
  res.status(204).end();
});

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` }));
app.use((error, _req, res, _next) => {
  if (error?.code === 11000) return res.status(409).json({ error: "An invoice with this customer and number already exists." });
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: error.message });
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Check the server log for details." });
});

try {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing. Copy .env.example to server/.env and set it.");
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, () => console.log(`Portal Ledger API listening on http://localhost:${port}`));
} catch (error) {
  console.error(`Could not start Portal Ledger API: ${error.message}`);
  process.exit(1);
}
