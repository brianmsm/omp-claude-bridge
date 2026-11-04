// Controlled SDK quota-matrix fixture. No Anthropic network requests.
import activate, { __test } from "../../src/index.ts";
import { createAssistantMessageEventStream } from "@oh-my-pi/pi-ai";
const quotaMessage = "You're out of extra usage · resets 6:30pm (Europe/Madrid)";
const quotaMode = process.env.QUOTA_FIXTURE_MODE || "rate-event-synthetic";
__test.setQuery((({options}) => ({
  async *[Symbol.asyncIterator]() {
    if (options?.resume) yield {type:"system",subtype:"init",session_id:options.resume};
    if (quotaMode.startsWith("rate-event")) yield {
      type:"rate_limit_event",
      rate_limit_info:{status:"rejected",resetsAt:Math.ceil(Date.now()/1000)+3600,rateLimitType:"five_hour"}
    };
    if (quotaMode.endsWith("synthetic")) yield {
      type:"assistant",parent_tool_use_id:null,
      message:{id:"cc-synthetic-quota-error",model:"<synthetic>",content:[{type:"text",text:quotaMessage}]}
    };
    yield {type:"result",subtype:"success",is_error:true,result:quotaMessage};
  },
  close() {}, async interrupt() {}
}) as any));
export default function(pi) {
  activate(pi);
  pi.registerProvider("mock-recovery", {
    baseUrl:"http://127.0.0.1:9/v1",apiKey:"mock-not-a-key",api:"mock-recovery",
    models:[{id:"fallback",name:"Synthetic local fallback",reasoning:false,input:["text"],
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:8192}],
    streamSimple:(model)=>{
      const stream=createAssistantMessageEventStream();
      const msg={role:"assistant",api:model.api,provider:model.provider,model:model.id,
        content:[{type:"text",text:"FALLBACK_OK"}],stopReason:"stop",
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,
          cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
      stream.push({type:"start",partial:msg});
      stream.push({type:"done",reason:"stop",message:msg});
      return stream;
    }
  });
}
