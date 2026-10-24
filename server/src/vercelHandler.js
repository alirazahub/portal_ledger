import mongoose from "mongoose";
import app, { initializeDatabase } from "./app.js";

let connectionPromise;

export default async function handler(req, res) {
  if (!process.env.MONGODB_URI) return res.status(503).json({ error: "MONGODB_URI is not configured." });
  try {
    if (mongoose.connection.readyState !== 1) {
      connectionPromise ??= mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await connectionPromise;
    }
    await initializeDatabase();
    return app(req, res);
  } catch (error) {
    connectionPromise = null;
    console.error("Portal Ledger database initialization failed:", error);
    return res.status(503).json({ error: "Database unavailable." });
  }
}
