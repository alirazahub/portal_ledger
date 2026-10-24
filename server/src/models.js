import mongoose from "mongoose";
const { Schema } = mongoose;
const oid = Schema.Types.ObjectId;
const OrganizationSchema = new Schema({ name: { type: String, required: true, trim: true, maxlength: 120 } }, { timestamps: true });
const UserSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  passwordHash: { type: String, required: true, select: false },
  organizationId: { type: oid, ref: "Organization", required: true, index: true },
  role: { type: String, enum: ["owner", "admin", "accountant", "viewer"], required: true },
}, { timestamps: true });
const SessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: oid, ref: "User", required: true, index: true },
  organizationId: { type: oid, ref: "Organization", required: true, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const InvitationSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  role: { type: String, enum: ["admin", "accountant", "viewer"], required: true },
  organizationId: { type: oid, ref: "Organization", required: true, index: true },
  createdBy: { type: oid, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date, default: null },
}, { timestamps: true });
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
InvitationSchema.index({ organizationId: 1, email: 1, acceptedAt: 1 });
const AuthAttemptSchema = new Schema({ keyHash: { type: String, required: true, index: true }, expiresAt: { type: Date, required: true } }, { timestamps: { createdAt: true, updatedAt: false } });
AuthAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SetupLockSchema = new Schema({
  key: { type: String, required: true, unique: true },
  claimedAt: { type: Date, default: null },
  claimExpiresAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

const InvoiceSchema = new Schema({
  organizationId: { type: oid, ref: "Organization", required: true },
  number: { type: String, required: true, trim: true, maxlength: 80 },
  client: { type: String, required: true, trim: true, maxlength: 160 },
  amount: { type: Number, required: true, min: 0.01 },
  portal: { type: String, required: true, trim: true, maxlength: 120 },
  submitted: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  due: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["Draft", "Submitted", "Approved", "Processing", "Paid"], default: "Draft" },
  reference: { type: String, trim: true, maxlength: 120, default: "" },
  note: { type: String, trim: true, maxlength: 2000, default: "" },
  paidAt: { type: String, default: "" },
}, { timestamps: true });
InvoiceSchema.index({ organizationId: 1, client: 1, number: 1 }, { unique: true, partialFilterExpression: { organizationId: { $type: "objectId" } } });
InvoiceSchema.index({ organizationId: 1, due: 1 });
const PortalSchema = new Schema({
  organizationId: { type: oid, ref: "Organization", required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  url: { type: String, trim: true, default: "", validate: { validator: value => !value || /^https?:\/\//i.test(value), message: "Portal URLs must use http or https." } },
}, { timestamps: true });
PortalSchema.index({ organizationId: 1, name: 1 }, { unique: true });
const DocumentSchema = new Schema({
  organizationId: { type: oid, ref: "Organization", required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, enum: ["Insurance", "Registration", "Tax document", "Safety certificate", "Other"], default: "Other" },
  expiresAt: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
}, { timestamps: true });
DocumentSchema.index({ organizationId: 1, expiresAt: 1 });

export const Organization = mongoose.models.Organization || mongoose.model("Organization", OrganizationSchema);
export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);
export const Invitation = mongoose.models.Invitation || mongoose.model("Invitation", InvitationSchema);
export const AuthAttempt = mongoose.models.AuthAttempt || mongoose.model("AuthAttempt", AuthAttemptSchema);
export const SetupLock = mongoose.models.SetupLock || mongoose.model("SetupLock", SetupLockSchema);
export const Invoice = mongoose.models.Invoice || mongoose.model("Invoice", InvoiceSchema);
export const Portal = mongoose.models.Portal || mongoose.model("Portal", PortalSchema);
export const TrackedDocument = mongoose.models.TrackedDocument || mongoose.model("TrackedDocument", DocumentSchema);
