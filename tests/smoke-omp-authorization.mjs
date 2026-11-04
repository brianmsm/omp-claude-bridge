/** End-to-end tool authorization regression against the real OMP CLI.
 * All Claude Code messages and MCP tools/call acknowledgements come from a
 * controlled Agent SDK. NO external Anthropic calls or credentials are needed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("..",import.meta.url));
const root=mkdtempSync(join(tmpdir(),"omp-security-gate-"));
const scenarios=[
  {mode:"denied",written:[],approvals:[]},
  {mode:"absent",written:[],approvals:[]},
  {mode:"allowed",written:["allowed-one.txt"],approvals:[false]},
  {mode:"parallel",written:["allowed-one.txt","allowed-two.txt"],approvals:[false,false]},
  {mode:"mixed",written:["allowed-one.txt"],approvals:[false]},
  {mode:"mismatch",written:[],approvals:[true]},
  {mode:"duplicate",written:["allowed-one.txt"],approvals:[false,true]}
];
const expectedContents={
  "allowed-one.txt":"ALLOWED_1",
  "allowed-two.txt":"ALLOWED_2"
};
try {
  for(const {mode,written,approvals} of scenarios) {
    const dir=join(root,mode);
    mkdirSync(dir,{recursive:true});
    const trace=join(dir,"gate-trace.json");
    const env={
      ...process.env,
      GATE_TEST_MODE:mode,
      GATE_TEST_DIR:dir,
      GATE_TEST_TRACE:trace,
      PI_CODING_AGENT_DIR:join(dir,"agent"),
      PI_PACKAGE_DIR:join(dir,"packages"),
      CLAUDE_CONFIG_DIR:join(dir,"claude"),
      XDG_CACHE_HOME:join(dir,"cache"),
      XDG_DATA_HOME:join(dir,"data"),
      XDG_STATE_HOME:join(dir,"state")
    };
    delete env.OMP_PROFILE;
    delete env.PI_PROFILE;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.CLAUDECODE;
    const run=spawnSync(process.env.OMP_BIN??resolve(repo,"node_modules/.bin/omp"),[
      "--cwd",dir,"--no-session","--no-extensions",
      "-e",resolve(repo,"tests/fixtures/authorization-gate-sdk.ts"),
      "--no-lsp","--no-skills","--no-rules","--no-context-files",
      "--no-title","--no-pty","--tools=write","--approval-mode=yolo",
      "--model","claude-bridge/claude-haiku-4-5","--mode","json",
      "--print","Use a write tool in the sample directory."
    ],{cwd:root,env,encoding:"utf8",input:"",timeout:45000,maxBuffer:6*1024*1024});
    assert.equal(run.status,0,`${mode}: process exit ${run.status}\n${run.error??""}\n${run.stderr}\n${run.stdout.slice(-5000)}`);
    const frames=run.stdout.split("\n").flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
    const starts=frames.filter(x=>x.type==="tool_execution_start");
    const ends=frames.filter(x=>x.type==="tool_execution_end");
    assert.equal(starts.length,written.length,`${mode}: incorrect native OMP tool executions: ${JSON.stringify(starts)}`);
    assert.equal(ends.length,written.length,`${mode}: missing native result/ended event`);
    assert.ok(starts.every(x=>x.toolName==="write"),`${mode}: wrong OMP tool executed`);
    for(const name of ["allowed-one.txt","allowed-two.txt","denied-target.txt","altered-mcp.txt"]){
      const file=join(dir,name);
      if(written.includes(name)) {
        assert.ok(existsSync(file),`${mode}: authorized ${name} missing`);
        assert.equal(readFileSync(file,"utf8"),expectedContents[name]);
      }else {
        assert.ok(!existsSync(file),`${mode}: unauthorized ${name} was created`);
      }
    }
    assert.ok(existsSync(trace),`${mode}: no SDK trace`);
    const t=JSON.parse(readFileSync(trace,"utf8"));
    assert.equal(t.mode,mode);
    assert.deepEqual(t.observations.filter(x=>x.approved||x.duplicate).map(x=>x.response),approvals,
      `${mode}: incorrect MCP authorization/rejection replies: ${JSON.stringify(t.observations)}`);
    assert.ok(frames.some(x=>x.type==="agent_end"),`${mode}: OMP agent never settled`);
    console.log(`Authorization gate OMP smoke PASS: ${mode}; native tool executions=${starts.length}`);
  }
}finally {
  rmSync(root,{recursive:true,force:true});
}
