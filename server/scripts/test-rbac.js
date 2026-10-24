import "dotenv/config";
import assert from "node:assert/strict";

if (process.env.DEMO_TEST_CONFIRM !== "YES") throw new Error("Set DEMO_TEST_CONFIRM=YES to confirm role tests against your isolated demo server.");
const uri = new URL(process.env.MONGODB_URI || "");
const db = new URLSearchParams(uri.search).get("dbName") || uri.pathname.replace(/^\//, "");
if (!db.endsWith("_demo")) throw new Error("Refusing role tests: MONGODB_URI database name must end with _demo.");
const base = (process.env.DEMO_API_URL || "http://localhost:4000").replace(/\/$/, "");
const accounts = [
  ["owner","owner@portal-ledger.test"],["admin","admin@portal-ledger.test"],
  ["accountant","accountant@portal-ledger.test"],["viewer","viewer@portal-ledger.test"]
];
async function request(path, {email, method="GET", body}={}) {
  const headers={"content-type":"application/json"};
  if(email) headers.cookie=cookies.get(email);
  const res=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  return {status:res.status,body:await res.json().catch(()=>({})),headers:res.headers};
}
const cookies=new Map();
let passed=0;
async function check(label,expected,actual){assert.equal(actual,expected,label);passed++;console.log("PASS "+label);}
for(const [role,email] of accounts){
  const login=await request("/api/auth/login",{method:"POST",body:{email,password:"PortalDemo-2026-Access!"}});
  await check(role+" can sign in",200,login.status);
  const cookie=login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie,role+" login must set session cookie");cookies.set(email,cookie);
  const me=await request("/api/auth/me",{email});
  await check(role+" authenticated identity",role,me.body?.data?.role);
  for(const path of ["/api/invoices","/api/portals","/api/documents","/api/entities"]){
    const response=await request(path,{email}); await check(role+" can read "+path,200,response.status);
  }
  const audit=await request("/api/audit",{email});
  await check(role+" audit access policy",["owner","admin"].includes(role)?200:403,audit.status);
  const members=await request("/api/team/members",{email});
  await check(role+" team access policy",["owner","admin"].includes(role)?200:403,members.status);
  const invoice=await request("/api/invoices",{email,method:"POST",body:{number:"RBAC-"+role+"-"+Date.now(),client:"RBAC smoke test",amount:125,currency:"EUR",portal:"Coupa Supplier Portal",submitted:new Date().toISOString().slice(0,10),due:new Date(Date.now()+86400000).toISOString().slice(0,10),status:"Draft"}});
  await check(role+" invoice creation policy",role==="viewer"?403:201,invoice.status);
  if(invoice.status===201){const id=invoice.body?.data?._id||invoice.body?.data?.id;if(id) await request("/api/invoices/"+id,{email,method:"DELETE"});}
}
console.log("Passed "+passed+" role checks. The test includes creation checks; cleanup occurs for created smoke-test invoices.");
