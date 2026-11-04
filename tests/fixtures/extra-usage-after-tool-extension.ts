// Rate-limit event delivered AFTER an MCP-authorized native OMP tool.
// Reproduces the delayed SDK overage classification without Anthropic traffic.
import activate, { __test } from "../../src/index.ts";
import { writeFileSync } from "node:fs";

async function connectMcp(server:any) {
 const pending=new Map<number,(x:any)=>void>();
 const transport:any={start:async()=>{},close:async()=>{},
  send:async(msg:any)=>pending.get(msg.id)?.(msg)};
 await server.instance.connect(transport);
 let next=0;
 const request=(method:string,params:any)=>new Promise<any>(resolve=>{
  const id=++next;pending.set(id,resolve);
  transport.onmessage({jsonrpc:"2.0",id,method,params});
 });
 await request("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"overage-boundary",version:"1.0.0"}});
 transport.onmessage({jsonrpc:"2.0",method:"notifications/initialized"});
 return {
  call:(name:string,id:string,args:any)=>request("tools/call",{
   name,arguments:args,_meta:{"claudecode/toolUseId":id}
  })
 };
}
function* modelTool(id:string,name:string,args:any,index=0){
 const ev=(event:any)=>({type:"stream_event",parent_tool_use_id:null,event});
 yield ev({type:"message_start",message:{id:"msg_"+id,usage:{}}});
 yield ev({type:"content_block_start",index,content_block:{type:"tool_use",id,name:"mcp__custom-tools__"+name,input:{}}});
 yield ev({type:"content_block_delta",index,delta:{type:"input_json_delta",partial_json:JSON.stringify(args)}});
 yield ev({type:"content_block_stop",index});
 yield ev({type:"message_delta",delta:{stop_reason:"tool_use"},usage:{}});
 yield ev({type:"message_stop"});
}
__test.setQuery(({options}:any)=>{
 const trace=process.env.OVERAGE_AFTER_TOOL_TRACE!;
 const state:Record<string,unknown>={started:true,afterOverage:false,firstToolAuthorized:false,secondToolAttempted:false};
 const save=()=>writeFileSync(trace,JSON.stringify(state,null,2));
 save();
 const gen=(async function*(){
  try {
   const mcp=await connectMcp(options.mcpServers["custom-tools"]);
   const read={path:"seed.txt"};
   yield* modelTool("toolu_read_01","read",read);
   const first=await mcp.call("read","toolu_read_01",read);
   state.firstToolAuthorized=first.result?.isError!==true;
   save();
   yield {type:"rate_limit_event",rate_limit_info:{
     status:"allowed",rateLimitType:"five_hour",isUsingOverage:true,
     overageStatus:"allowed",resetsAt:Math.floor(Date.now()/1000)+1800
   }};
   // A stop on Extra Usage must prevent SDK iteration from ever reaching here.
   state.afterOverage=true;
   save();
   const write={path:"second-tool-should-not-exist.txt",content:"ALLOWED_ONLY_IF_OPTED_IN"};
   yield* modelTool("toolu_write_02","write",write);
   state.secondToolAttempted=true;
   save();
   const second=await mcp.call("write","toolu_write_02",write);
   state.secondToolAuthorized=second.result?.isError!==true;
   save();
   yield {type:"assistant",parent_tool_use_id:null,message:{
     id:"msg_after_overage",content:[{type:"text",text:"SECOND_TOOL_COMPLETED"}]
   }};
   yield {type:"result",subtype:"success",result:"SECOND_TOOL_COMPLETED",is_error:false};
  } finally {
   state.generatorClosed=true;
   save();
  }
 })() as any;
 gen.close=()=>{state.wasClosed=true;save();};
 gen.interrupt=async()=>{state.wasInterrupted=true;save();};
 return gen;
});
export default activate;
