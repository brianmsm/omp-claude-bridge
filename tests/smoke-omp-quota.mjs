import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo=fileURLToPath(new URL("..",import.meta.url));
const root=mkdtempSync(join(tmpdir(),"omp-bridge-quota-smoke-"));
const config=join(root,"fallback.yml");
writeFileSync(config,[
  "retry:",
  "  enabled: true",
  "  maxRetries: 1",
  "  modelFallback: true",
  "  fallbackOn: any",
  "  fallbackChains:",
  "    \"claude-bridge/claude-haiku-4-5\":",
  "      - mock-recovery/fallback",
  ""
].join("\n"));
try {
  for (const mode of ["rate-event-synthetic","no-event-synthetic","no-event-nonsynthetic"]) {
    const name=mode.replaceAll("-","_");
    const env={
      ...process.env,
      PI_CODING_AGENT_DIR:join(root,`agent-${name}`),
      PI_PACKAGE_DIR:join(root,`packages-${name}`),
      CLAUDE_CONFIG_DIR:join(root,`claude-${name}`),
      XDG_CACHE_HOME:join(root,`cache-${name}`),
      XDG_STATE_HOME:join(root,`state-${name}`),
      XDG_DATA_HOME:join(root,`data-${name}`),
      QUOTA_FIXTURE_MODE:mode,
    };
    delete env.OMP_PROFILE;
    delete env.PI_PROFILE;
    const run=spawnSync(process.env.OMP_BIN??resolve(repo,"node_modules/.bin/omp"),[
      "--cwd",root,"--no-session","--no-extensions",
      "-e",resolve(repo,"tests/fixtures/quota-matrix-extension.ts"),
      "--no-tools","--no-lsp","--no-skills","--no-rules","--no-context-files","--no-title",
      "--config",config,
      "--model","claude-bridge/claude-haiku-4-5","--mode","json",
      "-p","Summarize the sample text."
    ],{cwd:root,env,encoding:"utf8",input:"",timeout:45000,maxBuffer:6*1024*1024});
    assert.equal(run.status,0,`${mode}: ${run.error??""}\n${run.stderr}\n${run.stdout}`);
    const lines=run.stdout.split("\n").flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
    const events=lines.map(e=>e.type);
    assert.ok(events.includes("retry_fallback_applied"),`${mode} did not apply fallback`);
    assert.ok(events.includes("retry_fallback_succeeded"),`${mode} did not complete fallback`);
    const messages=lines.filter(e=>e.type==="message_end"&&e.message?.role==="assistant");
    assert.ok(messages.some(e=>e.message.provider==="mock-recovery"&&
      e.message.content?.some(x=>x.type==="text"&&x.text==="FALLBACK_OK")),`${mode} missing mock provider response`);
    console.log(`Quota smoke passed: ${mode}, retry/fallback succeeded.`);
  }
} finally {
  rmSync(root,{recursive:true,force:true});
}
