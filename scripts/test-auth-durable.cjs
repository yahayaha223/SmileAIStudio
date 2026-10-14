"use strict";
// All remote operations are synthetic. No credentials, email or AI calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
process.env.AUTH_ENVIRONMENT = "production";
process.env.AUTH_RP_ID = "studio.egaonokiroku.co.jp";
process.env.AUTH_ENFORCEMENT_MODE = "enforce";
process.env.AUTH_IP_HASH_SALT = "synthetic";
process.env.NETLIFY = "true";
const origin = "https://studio.egaonokiroku.co.jp";
const base = path.join(__dirname, "../netlify/functions");
const authKv = require(path.join(base, "shared/auth/auth-kv"));
const sessions = require(path.join(base, "shared/auth/sessions"));
const config = require(path.join(base, "shared/auth/config"));
const crypt = require(path.join(base, "shared/auth/crypto-util"));
const webauthn = require(path.join(base, "shared/auth/webauthn-service"));
const originalVerify = webauthn.verifyAuthentication;
webauthn.verifyAuthentication = async () => ({ok:true, userId:"synthetic-owner"});
globalThis.fetch = async () => { throw Error("Live network forbidden"); };
let passed = 0;
const reports = [];
const originalLog = console.log;
console.log = () => {}; // Existing audit summaries are not test output.
async function test(name, fn) { await fn(); passed++; reports.push(name); }
function storeFixture() {
  const data = new Map([["production/users/synthetic-owner", {id:"synthetic-owner",role:"owner",status:"active"}]]);
  const calls = [];
  const control = {failRead:false, failWrite:null, failDelete:false};
  const store = {
    get:async (key,opts) => {
      assert.equal(opts.consistency,"strong"); calls.push(["get",key]);
      if(control.failRead) throw Error("synthetic sensitive SDK detail");
      return data.has(key)?structuredClone(data.get(key)):null;
    },
    setJSON:async (key,value) => {
      calls.push(["set",key]);
      if(control.failWrite && key.includes(control.failWrite)) throw Error("synthetic sensitive SDK detail");
      data.set(key,structuredClone(value));
    },
    delete:async key => {if(control.failDelete) throw Error("synthetic detail");data.delete(key);}
  };
  return {data,calls,control,store};
}
function req(route, method="GET", jar="", csrf="", body) {
  return new Request(origin+"/api/auth/"+route,{method,
    headers:{origin,cookie:jar,"x-csrf-token":csrf,"content-type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function login(handler) {
  return handler(req("passkey/login/verify","POST","","",{credential:{synthetic:true}}));
}
function cookiePair(response) {
  const cookies=response.headers.getSetCookie();
  assert.equal(cookies.length,2);
  assert(cookies[0].includes("HttpOnly")); assert(!cookies[1].includes("HttpOnly"));
  assert(cookies.every(x=>x.includes("Path=/")&&x.includes("SameSite=Lax")&&!x.includes("Domain=")));
  return {jar:cookies.map(x=>x.split(";")[0]).join("; "),csrf:decodeURIComponent(cookies[1].split(";")[0].split("=")[1])};
}
function independentKv() {
  const file=path.join(base,"shared/auth/auth-kv.js"), module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,"utf8"),{module,exports:module.exports,Buffer,
    process:{env:{NETLIFY:"true"},cwd:()=>"/synthetic"},
    require:name=>name==="./config"?config:name==="fs"?new Proxy({}, {get:()=>()=>{throw Error("Filesystem forbidden");}}):require(name)});
  return module.exports;
}
(async()=>{
  const {createNativeHandler}=await import("../netlify/functions/api-auth.mjs");
  const fixture=storeFixture();
  const make=()=>createNativeHandler({getStore:options=>{
    assert.equal(options.name,"smile-studio-auth");assert.equal(options.consistency,"strong");return fixture.store;
  }});
  const handler=make();let pair;
  await test("normal login persists session and separate session/CSRF cookies",async()=>{
    const r=await login(handler);assert.equal(r.status,200);assert.equal((await r.json()).ok,true);pair=cookiePair(r);
    assert([...fixture.data.keys()].some(k=>k.startsWith("production/sessions/")));
  });
  await test("second handler reads durable session and preserves owner/full",async()=>{
    const r=await make()(req("session","GET",pair.jar));const b=await r.json();
    assert.equal(r.status,200);assert.equal(b.authenticated,true);assert.equal(b.role,"owner");assert.equal(b.purpose,"full");
  });
  for(const key of ["sessions/","sessionsByUser/","auditLogs/"]){
    await test("write failure at "+key+" returns 503 without cookies",async()=>{
      fixture.control.failWrite=key;const r=await login(handler);fixture.control.failWrite=null;
      assert.equal(r.status,503);assert.equal(r.headers.getSetCookie().length,0);
      assert.equal(await r.text(),JSON.stringify({ok:false,error:"unavailable"}));
    });
  }
  await test("strong read failure has no cached login or secret error",async()=>{
    fixture.control.failRead=true;const r=await handler(req("session","GET",pair.jar));fixture.control.failRead=false;
    assert.equal(r.status,503);assert.equal(r.headers.getSetCookie().length,0);assert(!await r.text().then(x=>x.includes("sensitive")));
  });
  await test("deleted durable session cannot be resurrected from memory",async()=>{
    const key="production/sessions/"+crypt.hashToken(decodeURIComponent(pair.jar.split(";")[0].split("=")[1]));
    const saved=fixture.data.get(key);fixture.data.delete(key);
    const b=await (await handler(req("session","GET",pair.jar))).json();assert.equal(b.authenticated,false);fixture.data.set(key,saved);
  });
  for(const field of ["expiresAt","absoluteExpiresAt"]){
    await test("expired "+field+" is rejected without renewal",async()=>{
      const created=await authKv.withRequestStore(fixture.store,()=>sessions.createSession({id:"synthetic-owner",role:"owner"}));
      const key="production/sessions/"+created.session.sessionHash;fixture.data.get(key)[field]=1;
      const before=fixture.calls.filter(x=>x[0]==="set").length;
      const b=await (await handler(req("session","GET","smile_studio_session="+created.rawId))).json();
      assert.equal(b.authenticated,false);assert.equal(fixture.calls.filter(x=>x[0]==="set").length,before);
    });
  }
  for(const token of ["","wrong-synthetic"]){
    await test("logout rejects missing/mismatched CSRF",async()=>{
      const r=await handler(req("logout","POST",pair.jar,token,{}));assert.equal(r.status,403);assert.equal(r.headers.getSetCookie().length,0);
    });
  }
  await test("valid CSRF logout revokes durable session",async()=>{
    const r=await handler(req("logout","POST",pair.jar,pair.csrf,{}));assert.equal(r.status,200);
    assert(r.headers.getSetCookie().every(x=>x.includes("Max-Age=0")));
    const b=await (await handler(req("session","GET",pair.jar))).json();assert.equal(b.authenticated,false);
  });
  await test("foreign login origin stays forbidden",async()=>{
    const r=await handler(new Request(origin+"/api/auth/passkey/login/verify",{method:"POST",headers:{origin:"https://foreign.invalid"},body:"{}"}));
    assert.equal(r.status,403);assert.equal(r.headers.getSetCookie().length,0);
  });
  await test("missing native storage context returns 503 with no cookies",async()=>{
    const broken=createNativeHandler({getStore:()=>{throw Error("synthetic sensitive context");}});
    const r=await broken(req("session"));assert.equal(r.status,503);assert.equal(r.headers.getSetCookie().length,0);
    assert.equal(await r.text(),JSON.stringify({ok:false,error:"unavailable"}));
  });
  await test("OPTIONS keeps CORS and a valid empty response",async()=>{
    const r=await handler(req("session","OPTIONS"));assert.equal(r.status,204);assert.equal(await r.text(),"");
    assert.equal(r.headers.get("access-control-allow-origin"),origin);
  });
  await test("function redirect path and query route preserve routing",async()=>{
    for(const suffix of ["/session","?path=session"]){
      const r=await handler(new Request(origin+"/.netlify/functions/api-auth"+suffix));
      assert.equal(r.status,200);assert.equal((await r.json()).authenticated,false);
    }
  });
  await test("independent module instances read only shared durable data",async()=>{
    const a=independentKv(),b=independentKv(),f=storeFixture();
    await a.withRequestStore(f.store,()=>a.authSet("sessions/synthetic",{persisted:true}));
    assert.equal((await b.withRequestStore(f.store,()=>b.authGet("sessions/synthetic"))).persisted,true);
    f.data.delete("production/sessions/synthetic");
    assert.equal(await a.withRequestStore(f.store,()=>a.authGet("sessions/synthetic")),null);
    f.control.failRead=true;await assert.rejects(b.withRequestStore(f.store,()=>b.authGet("sessions/synthetic")),/auth_storage_unavailable/);
  });
  await test("concurrent requests isolate stores across awaits",async()=>{
    const a=storeFixture(),b=storeFixture();let release;const wait=new Promise(r=>release=r);
    const first=authKv.withRequestStore(a.store,async()=>{await wait;await authKv.authSet("probe",{which:"a"});});
    await authKv.withRequestStore(b.store,()=>authKv.authSet("probe",{which:"b"}));release();await first;
    assert.equal(a.data.get("production/probe").which,"a");assert.equal(b.data.get("production/probe").which,"b");assert.equal(authKv.hasRequestStore(),false);
  });
  await test("durable delete failure propagates",async()=>{
    fixture.control.failDelete=true;
    await assert.rejects(authKv.withRequestStore(fixture.store,()=>authKv.authDelete("synthetic")),/auth_storage_unavailable/);
    fixture.control.failDelete=false;
  });
  await test("legacy false save result cannot issue a new session",async()=>{
    const old=authKv.authSet;authKv.authSet=async()=>false;
    try{await assert.rejects(sessions.createSession({id:"synthetic-owner",role:"owner"}),/auth_storage_unavailable/);}
    finally{authKv.authSet=old;}
  });
  await test("legacy false index save cannot issue a new session",async()=>{
    const oldSet=authKv.authSet,oldGet=authKv.authGet;let writes=0;
    authKv.authSet=async()=>++writes===1;authKv.authGet=async()=>null;
    try{await assert.rejects(sessions.createSession({id:"synthetic-owner",role:"owner"}),/auth_storage_unavailable/);}
    finally{authKv.authSet=oldSet;authKv.authGet=oldGet;}
  });
  await test("existing credential record is read without schema migration",async()=>{
    const credentials=require(path.join(base,"shared/auth/credentials"));
    const existing={credentialId:"synthetic-credential",userId:"synthetic-owner",publicKey:"synthetic-public-key",counter:42};
    fixture.data.set("production/credentials/synthetic-credential",existing);
    const before=fixture.calls.filter(x=>x[0]==="set").length;
    const found=await authKv.withRequestStore(fixture.store,()=>credentials.getCredential("synthetic-credential"));
    assert.deepEqual(found,existing);assert.equal(fixture.calls.filter(x=>x[0]==="set").length,before);
  });
  await test("enrollment session remains unauthenticated in native endpoint",async()=>{
    const created=await authKv.withRequestStore(fixture.store,()=>sessions.createSession({id:"synthetic-owner",role:"owner"},{purpose:"passkey_enroll"}));
    const r=await handler(req("session","GET","smile_studio_session="+created.rawId));const b=await r.json();
    assert.equal(b.authenticated,false);assert.equal(b.enrollRequired,true);assert.equal(b.purpose,"passkey_enroll");
  });
  await test("native real SDK uses strong endpoint for reads and writes",async()=>{
    globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify({siteID:"synthetic",token:"synthetic",edgeURL:"https://cached.invalid",uncachedEdgeURL:"https://strong.invalid"})).toString("base64");
    let reads=0,writes=0;
    globalThis.fetch=async(url,opts)=>{assert.equal(new URL(url).hostname,"strong.invalid");
      if(opts.method.toUpperCase()==="GET")reads++;else if(opts.method.toUpperCase()==="PUT")writes++;else throw Error("Unexpected operation");
      return new Response(opts.method.toUpperCase()==="GET"?"null":"",{status:200});};
    const probe=createNativeHandler({handler:async()=>{
      await authKv.authGet("probe");await authKv.authSet("probe",{synthetic:true});
      return {statusCode:200,body:"{}"};
    }});
    assert.equal((await probe(req("session"))).status,200);assert.equal(reads,1);assert.equal(writes,1);
    delete globalThis.netlifyBlobsContext;
  });
  webauthn.verifyAuthentication=originalVerify;console.log=originalLog;
  console.log(JSON.stringify({passed,liveNetworkCalls:0,aiCalls:0,tests:reports},null,2));
})().catch(e=>{console.log=originalLog;console.error(e.stack);process.exitCode=1;});
