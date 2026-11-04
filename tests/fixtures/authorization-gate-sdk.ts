/** Controlled Claude Code SDK for OMP's permission dispatch boundary.
 * Runs through the real MCP server, real OMP provider, and native OMP write.
 * No network, auth, or subscription required.
 */
import activate, { __test } from "../../src/index.ts";
import { writeFileSync } from "node:fs";

const mode=process.env.GATE_TEST_MODE || "denied";
const traceFile=process.env.GATE_TEST_TRACE!;

async function connectMcp(server:any) {
  const pending=new Map<number,(x:any)=>void>();
  const transport:any={
    start:async()=>{}, close:async()=>{},
    send:async(msg:any)=>pending.get(msg.id)?.(msg)
  };
  await server.instance.connect(transport);
  let i=0;
  const request=(method:string,params:any)=>new Promise<any>(resolve=>{
    const id=++i;pending.set(id,resolve);
    transport.onmessage({jsonrpc:"2.0",id,method,params});
  });
  await request("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"authorization-ci",version:"1.0.0"}});
  transport.onmessage({jsonrpc:"2.0",method:"notifications/initialized"});
  return {
    call:(name:string,id:string,args:any)=>request("tools/call",{
      name,arguments:args,_meta:{"claudecode/toolUseId":id}
    })
  };
}
function output(text:string):any[] {
  return [
    {type:"stream_event",event:{type:"message_start",message:{id:"msg_ci_final",usage:{}}}},
    {type:"stream_event",event:{type:"content_block_start",index:0,content_block:{type:"text",text:""}}},
    {type:"stream_event",event:{type:"content_block_delta",index:0,delta:{type:"text_delta",text}}},
    {type:"stream_event",event:{type:"content_block_stop",index:0}},
    {type:"stream_event",event:{type:"message_delta",delta:{stop_reason:"end_turn"},usage:{}}},
    {type:"stream_event",event:{type:"message_stop"}},
    {type:"result",subtype:"success",is_error:false,result:text}
  ];
}
function* modelToolBatch(tools:Array<{id:string,args:any}>) {
  const ev=(event:any)=>({type:"stream_event",parent_tool_use_id:null,event});
  yield ev({type:"message_start",message:{id:"msg_tool_batch",usage:{}}});
  for(const [index,tool] of tools.entries()){
    yield ev({type:"content_block_start",index,content_block:{type:"tool_use",id:tool.id,name:"mcp__custom-tools__write",input:{}}});
    yield ev({type:"content_block_delta",index,delta:{type:"input_json_delta",partial_json:JSON.stringify(tool.args)}});
    yield ev({type:"content_block_stop",index});
  }
  yield ev({type:"message_delta",delta:{stop_reason:"tool_use"},usage:{}});
  yield ev({type:"message_stop"});
}

__test.setQuery(({options}:any)=>{
  const first={id:"toolu_ci_1",args:{path:"allowed-one.txt",content:"ALLOWED_1"}};
  const second={id:"toolu_ci_2",args:{path:"allowed-two.txt",content:"ALLOWED_2"}};
  const bad={id:"toolu_ci_3",args:{path:"denied-target.txt",content:"DENIED_MUST_NOT_WRITE"}};
  const requested=mode==="parallel"||mode==="mixed"?[first,mode==="mixed"?bad:second]:[first];
  const gen=(async function*(){
    const mcp=await connectMcp(options.mcpServers["custom-tools"]);
    const observations:any[]=[];
    yield* modelToolBatch(requested);
    if(mode==="denied"){
      // PreToolUse refused locally; no MCP tools/call is sent.
      yield {type:"user",parent_tool_use_id:null,message:{role:"user",content:[
        {type:"tool_result",tool_use_id:first.id,is_error:true,content:"PreToolUse denied by Claude Code"}
      ]}};
      observations.push({id:first.id,approved:false});
    }else if(mode==="absent"){
      observations.push({id:first.id,approved:false,description:"No callTool ever sent"});
    }else{
      const response=await mcp.call("write",first.id,mode==="mismatch"?{path:"altered-mcp.txt",content:"TAMPERED"}:first.args);
      observations.push({id:first.id,approved:true,response:response.result?.isError??null,text:response.result?.content?.[0]?.text?.slice(0,150)});
      if(mode==="duplicate"){
        const duplicate=await mcp.call("write",first.id,first.args);
        observations.push({id:first.id,duplicate:true,response:duplicate.result?.isError??null,text:duplicate.result?.content?.[0]?.text?.slice(0,150)});
      }
      if(mode==="parallel"){
        const secondResult=await mcp.call("write",second.id,second.args);
        observations.push({id:second.id,approved:true,response:secondResult.result?.isError??null,text:secondResult.result?.content?.[0]?.text?.slice(0,150)});
      }
      if(mode==="mixed"){
        yield {type:"user",parent_tool_use_id:null,message:{role:"user",content:[
          {type:"tool_result",tool_use_id:bad.id,is_error:true,content:"PreToolUse denied second write"}
        ]}};
        observations.push({id:bad.id,approved:false});
      }
    }
    writeFileSync(traceFile,JSON.stringify({mode,observations},null,2));
    for(const e of output("CI_GATE_"+mode.toUpperCase())) yield e;
  })() as any;
  gen.close=()=>{};
  gen.interrupt=async()=>{};
  return gen;
});
export default activate;
