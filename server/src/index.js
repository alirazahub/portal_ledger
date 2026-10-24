import "dotenv/config";
import mongoose from "mongoose";
import app, { initializeDatabase } from "./app.js";
const port = Number(process.env.PORT || 4000);
try {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing. Copy .env.example to server/.env and set it.");
  await mongoose.connect(process.env.MONGODB_URI);
  await initializeDatabase();
  app.listen(port, () => console.log(`Portal Ledger API listening on http://localhost:${port}`));
} catch (error) {
  console.error(`Could not start Portal Ledger API: ${error.message}`);
  process.exit(1);
}
