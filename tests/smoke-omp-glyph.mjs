import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "omp-bridge-glyph-smoke-"));
const trace = join(root, "query.json");
const env = {
  ...process.env,
  PI_CODING_AGENT_DIR:join(root,"agent"),
  PI_PACKAGE_DIR:join(root,"packages"),
  CLAUDE_CONFIG_DIR:join(root,"claude"),
  XDG_CACHE_HOME:join(root,"cache"),
  XDG_STATE_HOME:join(root,"state"),
  XDG_DATA_HOME:join(root,"data"),
  GLYPH_PILOT_TRACE:trace
};
delete env.OMP_PROFILE;
delete env.PI_PROFILE;
try {
  const privateGlyph = "\uE000";
  const iconGlyph = "\uF418";
  const prompt = `GLYPH_POLICY ${privateGlyph} and ${iconGlyph}, literal ⟦U1234⟧ must survive`;
  const run = spawnSync(process.env.OMP_BIN ?? resolve(repo,"node_modules/.bin/omp"),[
    "--no-session","--no-extensions","-e",resolve(repo,"tests/fixtures/glyph-pilot-extension.ts"),
    "--no-tools","--no-lsp","--no-skills","--no-rules","--no-context-files","--no-title",
    "--model","claude-bridge/claude-haiku-4-5","--mode","json",
    "--append-system-prompt",prompt,"-p","Return the controlled marker."
  ],{cwd:root,env,encoding:"utf8",input:"",timeout:45000,maxBuffer:4*1024*1024});
  assert.equal(run.status,0,`${run.error??""}\n${run.stderr}\n${run.stdout}`);
  assert.match(run.stdout,/GLYPH_PROVIDER_OK/);
  const t=JSON.parse(readFileSync(trace,"utf8"));
  assert.equal(t.containsEncodedGlyph,true,"OMP glyph codec must encode private-use characters");
  assert.equal(t.containsNotice,true,"the codec notice must be present in the projected prompt");
  assert.equal(t.glyphCodesInForwardedPrompt,0,"raw glyphs must not pass to Claude Code");
  assert.equal(t.model,"claude-haiku-4-5");
  assert.ok(t.append.includes("GLYPH_POLICY"),"the original policy must not be dropped");
  console.log("OMP glyph smoke passed: real host codec, capture, and SDK projection.");
} finally {
  rmSync(root,{recursive:true,force:true});
}
