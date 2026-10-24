import mongoose from "mongoose";

const InvoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, trim: true, maxlength: 80 },
    client: { type: String, required: true, trim: true, maxlength: 160 },
    amount: { type: Number, required: true, min: 0.01 },
    portal: { type: String, required: true, trim: true, maxlength: 120 },
    submitted: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    due: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: {
      type: String,
      enum: ["Draft", "Submitted", "Approved", "Processing", "Paid"],
      default: "Draft",
    },
    reference: { type: String, trim: true, maxlength: 120, default: "" },
    note: { type: String, trim: true, maxlength: 2000, default: "" },
    paidAt: { type: String, default: "" },
  },
  { timestamps: true }
);
InvoiceSchema.index({ client: 1, number: 1 }, { unique: true });

const PortalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 160 },
    url: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => !value || /^https?:\/\//i.test(value),
        message: "Portal URLs must use http or https.",
      },
    },
  },
  { timestamps: true }
);

const DocumentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: {
      type: String,
      enum: ["Insurance", "Registration", "Tax document", "Safety certificate", "Other"],
      default: "Other",
    },
    expiresAt: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { timestamps: true }
);

export const Invoice = mongoose.model("Invoice", InvoiceSchema);
export const Portal = mongoose.model("Portal", PortalSchema);
export const TrackedDocument = mongoose.model("TrackedDocument", DocumentSchema);
