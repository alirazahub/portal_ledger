import "dotenv/config";
import mongoose from "mongoose";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { AuditEvent, Invitation, Invoice, InvoiceEvidence, LegalEntity, Organization, Portal, Session, TrackedDocument, User } from "../src/models.js";

const scrypt = promisify(scryptCallback);
const defaultDemoPassword = "PortalDemo-2026-Access!";
const emails = ["owner@portal-ledger.test", "admin@portal-ledger.test", "accountant@portal-ledger.test", "viewer@portal-ledger.test"];
function assertSafeTarget() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required in server/.env.");
  const liveMode = process.env.DEMO_SEED_LIVE_CONFIRM === "YES_I_CONFIRM_LIVE_DEMO_DATA";
  if (process.env.DEMO_SEED_LIVE_CONFIRM && !liveMode) throw new Error("Live confirmation value is invalid.");
  const uri = new URL(process.env.MONGODB_URI);
  const database = new URLSearchParams(uri.search).get("dbName") || uri.pathname.replace(/^\//, "");
  if (liveMode) {
    if (!database || database.endsWith("_demo")) throw new Error("Live mode requires the production database name, not a *_demo database.");
    if (process.env.DEMO_SEED_RESET === "YES") throw new Error("Live seeding is insert-only and does not support reset.");
    const password = process.env.DEMO_SEED_PASSWORD || "";
    if (password.length < 20 || password.length > 128) throw new Error("Set DEMO_SEED_PASSWORD to a unique password of 20 to 128 characters for these demo accounts.");
    return { liveMode: true, database, password, workspaceName: "Portal Ledger Demo Sandbox (Synthetic)" };
  }
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production without the explicit live confirmation.");
  if (process.env.DEMO_SEED_CONFIRM !== "YES") throw new Error("Set DEMO_SEED_CONFIRM=YES to confirm a demo seed.");
  if (!database.endsWith("_demo")) throw new Error("Refusing to seed: MongoDB database name must end with _demo.");
  return { liveMode: false, database, password: defaultDemoPassword, workspaceName: "Portal Ledger Demo Workspace" };
}
function date(offsetDays) { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0,10); }
try {
  const target = assertSafeTarget();
  await mongoose.connect(process.env.MONGODB_URI);
  const existingWorkspace = await Organization.findOne({ name: target.workspaceName }).lean();
  if (existingWorkspace) throw new Error("The demo workspace already exists. This seeder never deletes or replaces data.");
  const existingAccount = await User.findOne({ email: { $in: emails } }).select("_id").lean();
  if (existingAccount) throw new Error("A demo login email is already in use. No records were added.");
  const organization = await Organization.create({ name: target.workspaceName });
  const password = target.password;
  const users = [];
  for (const [i, role] of ["owner","admin","accountant","viewer"].entries()) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, 64)).toString("hex");
    users.push(await User.create({ name: ["Olivia Owner","Avery Admin","Casey Accountant","Vera Viewer"][i], email: emails[i], passwordHash: salt + ":" + hash, organizationId: organization._id, role }));
  }
  const specs = [
    ["Northstar Robotics","France","EUR",true],["Cloudberry Health","United States","USD",false],["Juniper Mobility","United Kingdom","GBP",false]
  ];
  const entities = await LegalEntity.insertMany(specs.map(([name,country,currency,isDefault])=>({organizationId:organization._id,name,country,currency,isDefault})));
  const portalNames=["Coupa Supplier Portal","SAP Business Network","Ariba Network","Oracle Supplier Hub","Workday Supplier","Jaggaer One","Basware Portal","Tradeshift"];
  const portals = await Portal.insertMany(portalNames.map((name,i)=>({organizationId:organization._id,name,url:"https://example.com/"+name.toLowerCase().replaceAll(" ","-"),requirements:["PO number, invoice PDF, and receipt confirmation","Tax registration and bank details","Invoice PDF and service acceptance"][i%3],paymentTermsDays:[30,45,60,30,15,45,60,30][i]})));
  const statuses=["Draft","Submitted","Needs info","Rejected","Approved","Processing","Paid"];
  const invoices=[];
  for(let i=0;i<56;i++){
    const entity=entities[i%entities.length], status=statuses[i%statuses.length], portal=portals[i%portals.length];
    invoices.push({organizationId:organization._id,number:"DEMO-"+String(1001+i),client:["Aurora Systems","Meridian Labs","Kiteworks","Bluebird Energy","Pinecone AI","Atlas Devices","Monarch Data"][i%7],amount:Math.round((840+i*317.43)*100)/100,currency:entity.currency,entityId:entity._id,portal:portal.name,submitted:date(-((i*3)%75)),due:date(((i%19)-8)),status,reference:"PO-"+String(70000+i),note:status==="Needs info"?"Customer requested signed delivery evidence.":status==="Rejected"?"Rejected: invoice line total differs from purchase order.":"Demo record generated for role and workflow testing.",rejectionReason:status==="Rejected"?"Line total does not match the approved purchase order.":"",assignedTo:users[2]._id,followUpAt:["Submitted","Needs info","Rejected"].includes(status)?date((i%10)+1):"",expectedPaymentDate:["Approved","Processing"].includes(status)?date(18+i%21):"",paidAt:status==="Paid"?date(-((i%25)+1)):""});
  }
  const madeInvoices=await Invoice.insertMany(invoices);
  const docs=await TrackedDocument.insertMany(Array.from({length:15},(_,i)=>({organizationId:organization._id,name:["General liability insurance","Tax registration certificate","ISO 27001 certificate","Safety training register","Bank confirmation letter"][i%5]+" "+String(1+Math.floor(i/5)),category:["Insurance","Tax document","Safety certificate","Registration","Other"][i%5],expiresAt:date([-12,8,21,42,76,109,146,180,220,270,320,365,430,500,600][i])})));
  const pdf=Buffer.from("%PDF-1.4\nPortal Ledger synthetic demo evidence only\n%%EOF");
  await InvoiceEvidence.insertMany(madeInvoices.slice(0,6).map((inv,i)=>({organizationId:organization._id,invoiceId:inv._id,uploadedBy:users[i%users.length]._id,name:["invoice-copy.pdf","purchase-order.pdf","delivery-confirmation.pdf"][i%3],mimeType:"application/pdf",size:pdf.length,data:pdf})));
  const pendingToken=randomBytes(32).toString("hex");
  await Invitation.create({tokenHash:(await import("node:crypto")).createHash("sha256").update(pendingToken).digest("hex"),email:"new.teammate@portal-ledger.test",role:"accountant",organizationId:organization._id,createdBy:users[0]._id,expiresAt:new Date(Date.now()+7*86400000)});
  const events=[];
  for(let i=0;i<64;i++){const actor=users[i%users.length];events.push({organizationId:organization._id,actorId:actor._id,actorName:actor.name,actorRole:actor.role,action:["invoice.created","invoice.status.changed","evidence.uploaded","document.updated","portal.updated","team.invitation.created"][i%6],entityType:["invoice","invoice","evidence","document","portal","team"][i%6],entityId:String(madeInvoices[i%madeInvoices.length]._id),summary:"Demo audit event "+String(i+1)+" for role and activity-history testing.",createdAt:new Date(Date.now()-i*3600000)});}
  await AuditEvent.insertMany(events);
  console.log(JSON.stringify({workspace:organization.name,database:target.database,accounts:emails.map((email,i)=>({email,role:users[i].role})),password:target.liveMode?"Use the value set in DEMO_SEED_PASSWORD":password,dataset:{invoices:madeInvoices.length,entities:entities.length,portals:portals.length,renewalDocuments:docs.length,evidenceFiles:6,auditEvents:events.length,pendingInvitation:"new.teammate@portal-ledger.test"}},null,2));
} catch(error) { console.error(error.message); process.exitCode=1; }
finally { await mongoose.disconnect(); }
