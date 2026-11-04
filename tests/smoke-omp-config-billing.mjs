/** Integration regression of P0 project authority and P1 billing protection.
 * OMP runs for real; a controlled SDK emits deterministic events without network.
 */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";

const repo=fileURLToPath(new URL("..",import.meta.url));
const root=mkdtempSync(join(tmpdir(),"omp-config-billing-"));
const fakeExecutable=join(root,"fake-claude-exec.sh");
const fakeCalled=join(root,"fake-executable-ran");
writeFileSync(fakeExecutable,`#!/bin/sh\necho EXECUTED > ${JSON.stringify(fakeCalled)}\nexit 47\n`);
const secret="P0P1_TEST_KEY_SUPER_SECRET_5472";
const custom="https://secret-proxy.example.invalid/api";
const cases=[
 {name:"baseline",mode:"normal",expectedExit:0},
 {name:"extra-usage-default-deny",mode:"overage",expectedExit:1},
 {name:"extra-usage-allowed-globally",mode:"overage",global:{provider:{allowExtraUsage:true}},expectedExit:0},
 {name:"project-cannot-allow-overage",mode:"overage",global:{provider:{allowExtraUsage:false}},
  local:{provider:{allowExtraUsage:true}},expectedExit:1},
 {name:"project-cannot-change-executable",mode:"normal",
  global:{provider:{strictMcpConfig:true,autoMemoryEnabled:false}},
  local:{provider:{pathToClaudeCodeExecutable:fakeExecutable,strictMcpConfig:false,autoMemoryEnabled:true}},
  expectedExit:0},
 {name:"inherited-api-route-warning",mode:"normal",expectedExit:0,
  extraEnv:{ANTHROPIC_API_KEY:secret,ANTHROPIC_BASE_URL:custom,CLAUDE_CODE_USE_VERTEX:"true"},
  mustWarn:["ANTHROPIC_API_KEY","ANTHROPIC_BASE_URL","CLAUDE_CODE_USE_VERTEX"]},
 {name:"explicit-global-executable-remains-available",mode:"normal",expectedExit:0,
  global:{provider:{pathToClaudeCodeExecutable:fakeExecutable}},expectExecutable:fakeExecutable},
];
try{
 for(const test of cases){
  const cwd=join(root,test.name);
  const agent=join(cwd,"agent");
  mkdirSync(join(cwd,".omp"),{recursive:true});
  mkdirSync(agent,{recursive:true});
  if(test.global)writeFileSync(join(agent,"claude-bridge.json"),JSON.stringify(test.global));
  if(test.local)writeFileSync(join(cwd,".omp","claude-bridge.json"),JSON.stringify(test.local));
  const trace=join(cwd,"sdk-trace.json");
  const env={...process.env,
    PI_CODING_AGENT_DIR:agent,
    PI_PACKAGE_DIR:join(cwd,"packages"),
    CLAUDE_CONFIG_DIR:join(cwd,"claude"),
    XDG_CACHE_HOME:join(cwd,"cache"),
    XDG_DATA_HOME:join(cwd,"data"),
    XDG_STATE_HOME:join(cwd,"state"),
    BILLING_TEST_MODE:test.mode,
    BILLING_TEST_TRACE:trace
  };
  delete env.OMP_PROFILE;delete env.PI_PROFILE;
  for(const key of ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY","CLAUDECODE"])delete env[key];
  Object.assign(env,test.extraEnv??{});
  const run=spawnSync(process.env.OMP_BIN??resolve(repo,"node_modules/.bin/omp"),[
    "--cwd",cwd,"--no-session","--no-extensions",
    "-e",resolve(repo,"tests/fixtures/config-billing-guard-extension.ts"),
    "--no-tools","--no-lsp","--no-skills","--no-rules","--no-context-files","--no-title",
    "--model","claude-bridge/claude-haiku-4-5","--mode","json",
    "-p","Respond with the fixture marker."
  ],{cwd:root,env,encoding:"utf8",input:"",timeout:50000,maxBuffer:6*1024*1024});
  assert.equal(run.status,test.expectedExit,`${test.name}: unexpected exit ${run.status}; ${run.error??""}\n${run.stderr}\n${run.stdout.slice(-2500)}`);
  assert.ok(existsSync(trace),`${test.name}: controlled SDK was not invoked`);
  const captured=JSON.parse(readFileSync(trace,"utf8"));
  assert.equal(captured.executable,test.expectExecutable??null,`${test.name}: invalid executable propagation`);
  assert.equal(captured.strictMcp,true,`${test.name}: project disabled strict MCP`);
  assert.equal(captured.autoMemoryEnabled,false,`${test.name}: project enabled auto-memory`);
  assert.equal(captured.generatorClosed,true,`${test.name}: generator not settled`);
  const blocked=test.expectedExit!==0;
  assert.equal(captured.wasAllowedToContinue,!blocked,`${test.name}: overage stop behavior`);
  const frames=run.stdout.split("\n").flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
  const assistant=frames.filter(x=>x.type==="message_end"&&x.message?.role==="assistant");
  if(blocked){
    assert.ok(assistant.some(e=>e.message.stopReason==="error"&&
      /paid Extra Usage/.test(e.message.errorMessage??"")),`${test.name}: missing overage error message`);
    assert.ok(!run.stdout.includes("BILLING_FIXTURE_OK"),`${test.name}: streamed output after blocked event`);
  }else{
    assert.ok(run.stdout.includes("BILLING_FIXTURE_OK_"+test.mode.toUpperCase()),`${test.name}: missing successful response`);
  }
  if(test.mustWarn){
    for(const name of test.mustWarn)assert.ok(run.stderr.includes(name),`${test.name}: no warning for ${name}`);
    for(const sensitive of [secret,custom,"secret-proxy.example.invalid"])
      assert.ok(!run.stderr.includes(sensitive),`${test.name}: leaked billing route value`);
  }
  assert.equal(existsSync(fakeCalled),false,`${test.name}: untrusted executable was invoked`);
  console.log(`OMP P0/P1 smoke PASS: ${test.name}`);
 }
}finally{
 rmSync(root,{recursive:true,force:true});
}
