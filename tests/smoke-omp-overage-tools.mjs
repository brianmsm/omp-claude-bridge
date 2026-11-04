/** Checks Extra Usage detected after an MCP-authorized tool, not only at
 * the start of a query. Controlled SDK + real MCP/OMP, no Anthropic requests.
 */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";

const repo=fileURLToPath(new URL("..",import.meta.url));
const root=mkdtempSync(join(tmpdir(),"omp-bridge-overage-boundary-"));
try {
 for(const allowed of [false,true]) {
  const name=allowed?"globally-authorized":"default-block";
  const cwd=join(root,name);
  const agent=join(cwd,"agent");
  mkdirSync(agent,{recursive:true});
  writeFileSync(join(cwd,"seed.txt"),"READ_ONLY_FIXTURE\n");
  if(allowed) writeFileSync(join(agent,"claude-bridge.json"),JSON.stringify({provider:{allowExtraUsage:true}}));
  const trace=join(cwd,"audit.json");
  const env={...process.env,OVERAGE_AFTER_TOOL_TRACE:trace,
   PI_CODING_AGENT_DIR:agent,PI_PACKAGE_DIR:join(cwd,"packages"),
   CLAUDE_CONFIG_DIR:join(cwd,"claude"),XDG_CACHE_HOME:join(cwd,"cache"),
   XDG_DATA_HOME:join(cwd,"data"),XDG_STATE_HOME:join(cwd,"state")};
  for(const key of ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN","CLAUDECODE"])delete env[key];
  delete env.OMP_PROFILE;delete env.PI_PROFILE;
  const run=spawnSync(process.env.OMP_BIN??resolve(repo,"node_modules/.bin/omp"),[
   "--cwd",cwd,"--no-session","--no-extensions",
   "-e",resolve(repo,"tests/fixtures/extra-usage-after-tool-extension.ts"),
   "--no-lsp","--no-skills","--no-rules","--no-context-files",
   "--no-title","--no-pty","--tools=read,write","--approval-mode=yolo",
   "--model","claude-bridge/claude-haiku-4-5","--mode","json",
   "-p","Read seed.txt, then follow SDK prompts."
  ],{cwd:root,env,encoding:"utf8",input:"",timeout:60000,maxBuffer:6*1024*1024});
  const expected=allowed?0:1;
  assert.equal(run.status,expected,`${name}: exit=${run.status}\n${run.error??""}\n${run.stderr}\n${run.stdout.slice(-3500)}`);
  assert.ok(existsSync(trace),`${name}: no SDK trace`);
  const t=JSON.parse(readFileSync(trace,"utf8"));
  const frames=run.stdout.split("\n").flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
  const names=frames.filter(x=>x.type==="tool_execution_start").map(x=>x.toolName);
  assert.ok(t.firstToolAuthorized===true,`${name}: first read did not complete`);
  assert.ok(t.generatorClosed===true,`${name}: SDK not finalized`);
  assert.deepEqual(names,allowed?["read","write"]:["read"],`${name}: unauthorized native tool activity`);
  assert.equal(t.afterOverage,allowed,`${name}: SDK iterated after denied overage event`);
  assert.equal(t.secondToolAttempted,allowed,`${name}: unauthorized second MCP call`);
  const file=join(cwd,"second-tool-should-not-exist.txt");
  assert.equal(existsSync(file),allowed,`${name}: unexpected file side effect`);
  if(allowed)assert.equal(readFileSync(file,"utf8"),"ALLOWED_ONLY_IF_OPTED_IN");
  const last=frames.filter(x=>x.type==="message_end"&&x.message?.role==="assistant").at(-1)?.message;
  if(!allowed){
   assert.ok(frames.some(x=>x.type==="message_end"&&x.message?.stopReason==="error"&&
    /paid Extra Usage/.test(x.message?.errorMessage??"")),`${name}: missing error event`);
  }else{
   assert.ok(run.stdout.includes("SECOND_TOOL_COMPLETED"),`${name}: no continuation after explicit opt in`);
  }
  assert.ok(frames.some(x=>x.type==="agent_end"),`${name}: OMP never reached agent_end`);
  console.log(`OMP Extra Usage-after-tool PASS: ${name}, tools=${names.join(",")}, second-file=${existsSync(file)}`);
 }
}finally{
 rmSync(root,{recursive:true,force:true});
}
