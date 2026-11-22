import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { body } from "../src/api.mjs";

test("API body parsing supports Vercel parsed bodies and rejects invalid input",async()=>{
  assert.deepEqual(await body({body:{name:"Project"}}),{name:"Project"});
  assert.deepEqual(await body({body:'{"name":"Project"}'}),{name:"Project"});
  await assert.rejects(body({body:"invalid"}),{status:400});
  await assert.rejects(body({body:[]}),{status:400});
});

test("frontend reports non-JSON deployment errors and preserves JSON authentication errors",async()=>{
  const source=await readFile(new URL("../client/app.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("async function request("),source.indexOf("const labels ="));
  const context=vm.createContext({fetch:async()=>new Response("The page could not be found",{status:404,headers:{"Content-Type":"text/plain"}})});
  vm.runInContext(code,context);
  await assert.rejects(vm.runInContext('request("workspace/state")',context),/API returned an unexpected response \(HTTP 404\)/);
  context.fetch=async()=>Response.json({error:"Sign in to continue"},{status:401});
  await assert.rejects(vm.runInContext('request("workspace/state")',context),{status:401,message:"Sign in to continue"});
});

test("Vercel routes API and health to the shared backend",async()=>{
  const config=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(config.outputDirectory,"client/dist");
  assert.equal(config.rewrites[0].source,"/api/:path*");
  assert.equal(config.rewrites[0].destination,"/api/index?__overview_path=/api/:path*");
});
