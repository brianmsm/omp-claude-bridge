// Controlled Claude SDK fixture for authorization/billing tests.
// OMP and the bridge are real, but no Anthropic network requests are made.
import activate, { __test } from "../../src/index.ts";
import { writeFileSync } from "node:fs";

const mode = process.env.BILLING_TEST_MODE || "normal";
__test.setQuery(({ options }:any) => {
 let afterRateEvent = false;
 const state:Record<string,unknown> = {
   mode,
   executable: options?.pathToClaudeCodeExecutable ?? null,
   strictMcp: Object.hasOwn(options?.extraArgs ?? {}, "strict-mcp-config"),
   autoMemoryEnabled: options?.settings?.autoMemoryEnabled ?? null,
   wasAllowedToContinue: false,
 };
 const save=()=>writeFileSync(process.env.BILLING_TEST_TRACE!,JSON.stringify(state,null,2));
 save();
 return {
  async *[Symbol.asyncIterator]() {
   try {
     yield {type:"rate_limit_event",rate_limit_info:{
       status:"allowed",
       rateLimitType:"five_hour",
       isUsingOverage:mode==="overage",
       overageStatus:mode==="overage"?"allowed":"not_applicable",
       resetsAt:Math.floor(Date.now()/1000)+3600
     }};
     afterRateEvent = true;
     state.wasAllowedToContinue = true;
     save();
     const reply = "BILLING_FIXTURE_OK_" + mode.toUpperCase();
     yield {type:"assistant",parent_tool_use_id:null,message:{
       id:"billing-fixture-final",content:[{type:"text",text:reply}]
     }};
     yield {type:"result",subtype:"success",is_error:false,result:reply};
   } finally {
     state.generatorClosed = true;
     save();
   }
  },
  close() {
   state.wasClosed=true;
   save();
  },
  async interrupt() {
   state.wasInterrupted=true;
   save();
  },
 };
});
export default activate;
