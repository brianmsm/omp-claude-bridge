/** Auth-free tests for all three Claude Agent SDK entry points:
 * bridge provider (covered by OMP smokes), one-off summaries and AskClaude.
 */
import {describe,it,afterEach} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {refreshDirsFromEnv} from "@oh-my-pi/pi-utils";
const {__test}=await import("../src/index.js");

const model={id:"claude-haiku-4-5",name:"Claude Haiku 4.5",api:"claude-bridge",provider:"claude-bridge",
 contextWindow:200000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},input:["text"]};
const ctx={systemPrompt:"You are a summarizer.",messages:[{role:"user",content:[{type:"text",text:"Summarize this harmless note."}],timestamp:0}]};

function makeQuery(state,overage=true){
 return ({options})=>{
  state.options=options;
  const gen=(async function*(){
   try{
    yield {type:"rate_limit_event",rate_limit_info:{status:"allowed",isUsingOverage:overage,rateLimitType:"five_hour"}};
    state.didContinueAfterEvent=true;
    yield {type:"result",subtype:"success",is_error:false,result:"NO_OVERAGE_CONTINUATION"};
   }finally{
    state.generatorClosed=true;
   }
  })();
  gen.close=()=>{state.closed=true};
  gen.interrupt=async()=>{state.interrupted=true};
  return gen;
 };
}
function tempHome(fn){
 const old=process.env.PI_CODING_AGENT_DIR;
 const dir=mkdtempSync(join(tmpdir(),"omp-overage-sdk-paths-"));
 try{
  process.env.PI_CODING_AGENT_DIR=join(dir,"agent");
  refreshDirsFromEnv();
  mkdirSync(join(dir,"agent"),{recursive:true});
  return fn(dir);
 }finally{
  if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR=old;
  refreshDirsFromEnv();
  rmSync(dir,{recursive:true,force:true});
 }
}
afterEach(()=>{__test.setQuery(null);__test.setProviderSettings({})});

describe("Extra Usage gate in isolated compaction/summarizer",()=>{
 it("stops a one-off summary before consuming any post-overage SDK content",async()=>{
  await tempHome(async()=>{
   const st={};
   __test.setQuery(makeQuery(st));
   const warnings=[],original=console.error;
   console.error=(...args)=>warnings.push(args.map(String).join(" "));
   let result;
   try{result=await __test.isolatedStreamFn(model,ctx,{cacheRetention:"none"}).result()}
   finally{console.error=original}
   assert.equal(result.stopReason,"error");
   assert.match(result.errorMessage??"",/paid Extra Usage/);
   assert.equal(st.didContinueAfterEvent,undefined);
   assert.equal(st.generatorClosed,true);
   assert.equal(st.closed,true);
   assert.equal(warnings.filter(x=>x.includes("paid Extra Usage")).length,1);
  });
 });
 it("global allowExtraUsage true permits an isolated summary and warns once",async()=>{
  await tempHome(async dir=>{
   writeFileSync(join(dir,"agent","claude-bridge.json"),JSON.stringify({provider:{allowExtraUsage:true}}));
   const st={};
   __test.setQuery(makeQuery(st));
   const original=console.error;const warnings=[];console.error=(...args)=>warnings.push(args.map(String).join(" "));
   let result;try{result=await __test.isolatedStreamFn(model,ctx,{cacheRetention:"none"}).result()}
   finally{console.error=original}
   assert.equal(result.stopReason,"stop");
   assert.equal(st.didContinueAfterEvent,true);
   assert.equal(result.content?.filter(x=>x.type==="text").map(x=>x.text).join(""),"NO_OVERAGE_CONTINUATION");
   assert.equal(warnings.filter(x=>x.includes("paid Extra Usage")).length,1);
  });
 });
});
describe("Extra Usage gate in AskClaude one-shot",()=>{
 it("default policy refuses a metered AskClaude query, with no response content",async()=>{
  const st={};
  __test.setProviderSettings({});
  __test.setQuery(makeQuery(st));
  const original=console.error;const warnings=[];console.error=(...args)=>warnings.push(args.map(String).join(" "));
  try{
   await assert.rejects(__test.promptAndWait("A harmless question","none",new Map(),undefined,{isolated:true,model:"claude-haiku-4-5"}),/paid Extra Usage/);
  }finally{console.error=original}
  assert.equal(st.didContinueAfterEvent,undefined);
  assert.equal(st.generatorClosed,true);
  assert.equal(st.closed,true);
  assert.equal(warnings.filter(x=>x.includes("paid Extra Usage")).length,1);
 });
 it("explicit opt-in permits AskClaude to finish, with an overage warning",async()=>{
  const st={};
  __test.setProviderSettings({allowExtraUsage:true});
  __test.setQuery(makeQuery(st));
  const original=console.error;const warnings=[];console.error=(...args)=>warnings.push(args.map(String).join(" "));
  let result;
  try{result=await __test.promptAndWait("A harmless question","none",new Map(),undefined,{isolated:true,model:"claude-haiku-4-5"})}
  finally{console.error=original}
  assert.equal(result.responseText,"NO_OVERAGE_CONTINUATION");
  assert.equal(result.stopReason,"stop");
  assert.equal(st.didContinueAfterEvent,true);
  assert.equal(warnings.filter(x=>x.includes("paid Extra Usage")).length,1);
 });
 it("a non-overage SDK event never stops AskClaude without opt-in",async()=>{
  const st={};
  __test.setProviderSettings({});
  __test.setQuery(makeQuery(st,false));
  const result=await __test.promptAndWait("Harmless query","none",new Map(),undefined,{isolated:true,model:"claude-haiku-4-5"});
  assert.equal(result.responseText,"NO_OVERAGE_CONTINUATION");
  assert.equal(st.didContinueAfterEvent,true);
 });
});
