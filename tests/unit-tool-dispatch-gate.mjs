/** Security boundary regressions for tool_use -> OMP execution.
 * The provider model stream proposes an operation, but cannot authorize it.
 * Only a matching Claude Code MCP tools/call may authorize real dispatch.
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {ToolDispatchGate} from "../src/tool-dispatch-gate.js";

const tick=(ms=15)=>new Promise(resolve=>setTimeout(resolve,ms));
function setup({canDispatch=true,ms=2}={}){
  const gate=new ToolDispatchGate(ms),batches=[];
  let available=canDispatch;
  gate.setDispatcher(calls=>batches.push(calls),()=>available);
  return {gate,batches,availability:value=>{available=value;}};
}
function propose(gate,id,name="write",args={path:"file.txt",content:"x"},index=0){
  gate.propose(id,name,index,{});
  gate.append(index,JSON.stringify(args));
  gate.complete(index);
}
describe("Claude Code MCP authorization is the only dispatch boundary",()=>{
  it("does not run a model tool proposal without the MCP tools/call receipt",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();
    await tick();
    assert.deepEqual(batches,[]);
  });
  it("does not run a locally denied tool without a matching MCP call",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();
    gate.deny("toolu_1");
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"x"}),false);
    await tick();
    assert.deepEqual(batches,[]);
  });
  it("dispatches one authorized tool exactly once with the model arguments",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"x"}),true);
    await tick();
    assert.deepEqual(batches,[[{id:"toolu_1",name:"write",arguments:{path:"file.txt",content:"x"}}]]);
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"x"}),false);
  });
  it("fails closed for wrong names, IDs, and malformed/non-object arguments",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_wrong","write",{path:"file.txt",content:"x"}),false);
    assert.equal(gate.authorize("toolu_1","edit",{path:"file.txt",content:"x"}),false);
    assert.equal(gate.authorize("toolu_1","write",null),false);
    assert.equal(gate.authorize("toolu_1","write",["file.txt"]),false);
    await tick();
    assert.deepEqual(batches,[]);
  });
  it("refuses MCP arguments that differ from the streamed command",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_1","write",{path:"other.txt",content:"x"}),false);
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"changed"}),false);
    await tick();
    assert.deepEqual(batches,[]);
  });
  it("rejects authorization while JSON/tool proposal is incomplete",async()=>{
    const {gate,batches}=setup();
    gate.propose("toolu_1","write",0,{});
    gate.append(0,'{"path":"file.txt"');
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt"}),false);
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt"}),false);
    await tick();
    assert.deepEqual(batches,[]);
  });
  it("batches two approved tool calls, preserving model order despite reversed receipts",async()=>{
    const {gate,batches}=setup({ms:8});
    propose(gate,"toolu_a","read",{path:"a"},0);
    propose(gate,"toolu_b","read",{path:"b"},1);
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_b","read",{path:"b"}),true);
    assert.equal(gate.authorize("toolu_a","read",{path:"a"}),true);
    await tick(25);
    assert.deepEqual(batches,[[{id:"toolu_a",name:"read",arguments:{path:"a"}},{id:"toolu_b",name:"read",arguments:{path:"b"}}]]);
  });
  it("dispatches an authorized sibling while leaving an unapproved sibling inert",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_allowed","write",{path:"allowed"},0);
    propose(gate,"toolu_denied","write",{path:"denied"},1);
    gate.finishMessage();
    gate.authorize("toolu_allowed","write",{path:"allowed"});
    await tick();
    assert.deepEqual(batches,[[{id:"toolu_allowed",name:"write",arguments:{path:"allowed"}}]]);
    gate.deny("toolu_denied");
    await tick();
    assert.equal(batches.length,1);
  });
  it("accepts later sibling authorization only when a new OMP stream is available",async()=>{
    const {gate,batches,availability}=setup({ms:2});
    propose(gate,"toolu_first","read",{path:"a"},0);
    propose(gate,"toolu_second","read",{path:"b"},1);
    gate.finishMessage();
    gate.authorize("toolu_first","read",{path:"a"});
    await tick();
    assert.equal(batches.length,1);
    availability(false);
    assert.equal(gate.authorize("toolu_second","read",{path:"b"}),true);
    await tick();
    assert.equal(batches.length,1);
    availability(true); gate.resume();
    await tick();
    assert.deepEqual(batches[1],[{id:"toolu_second",name:"read",arguments:{path:"b"}}]);
  });
  it("does not re-execute a previously dispatched ID after a new model message",async()=>{
    const {gate,batches}=setup();
    propose(gate,"toolu_1");
    gate.finishMessage();gate.authorize("toolu_1","write",{path:"file.txt",content:"x"});
    await tick();
    gate.beginMessage();
    gate.stageComplete("toolu_1","write",0,{path:"file.txt",content:"x"});
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"x"}),false);
    await tick();
    assert.equal(batches.length,1);
  });
  it("supports the SDK nonstreaming assistant fallback after an approved MCP call",async()=>{
    const {gate,batches}=setup();
    gate.stageComplete("toolu_fallback","read",0,{path:"fallback.txt"});
    gate.finishMessage();
    assert.equal(gate.authorize("toolu_fallback","read",{path:"fallback.txt"}),true);
    await tick();
    assert.deepEqual(batches,[[{id:"toolu_fallback",name:"read",arguments:{path:"fallback.txt"}}]]);
  });
  it("cancels timed approvals on abort and rejects stale callbacks after reset",async()=>{
    const {gate,batches}=setup({ms:35});
    propose(gate,"toolu_1");gate.finishMessage();
    gate.authorize("toolu_1","write",{path:"file.txt",content:"x"});
    gate.reset();
    await tick(55);
    assert.deepEqual(batches,[]);
    assert.equal(gate.authorize("toolu_1","write",{path:"file.txt",content:"x"}),false);
  });
});
