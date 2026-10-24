import mongoose from "mongoose";
import app from "../server/src/app.js";

let connectionPromise;

export default async function handler(req, res) {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: "MONGODB_URI is not configured for this deployment." });
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      connectionPromise ??= mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await connectionPromise;
    }
    return app(req, res);
  } catch (error) {
    connectionPromise = null;
    console.error("MongoDB connection failed:", error);
    return res.status(503).json({ error: "Database unavailable. Check the deployment's MongoDB connection." });
  }
}
