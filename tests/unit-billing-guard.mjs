import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {billingRouteIndicators,billingRouteNotice,isUsingExtraUsage,EXTRA_USAGE_STOP_MESSAGE} from "../src/billing-guard.js";

describe("billing routing warnings never disclose secrets",()=>{
 it("default Claude login does not trigger a warning",()=>{
  assert.deepEqual(billingRouteIndicators({}),[]);
  assert.equal(billingRouteNotice({}),undefined);
 });
 it("only reports indicator NAMES, not credentials, custom endpoints or API tokens",()=>{
  const secret="sk-ant-secret-do-not-print-54722";
  const env={ANTHROPIC_API_KEY:secret,ANTHROPIC_AUTH_TOKEN:"oauth-secret",
   ANTHROPIC_BASE_URL:"https://hidden-secret.example.invalid/api",
   CLAUDE_CODE_USE_BEDROCK:"true",CLAUDE_CODE_USE_VERTEX:"1",CLAUDE_CODE_USE_FOUNDRY:"yes"};
  const flags=billingRouteIndicators(env);
  assert.deepEqual(flags,["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL",
   "CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY"]);
  const message=billingRouteNotice(env);
  for(const key of flags)assert.ok(message.includes(key),key);
  for(const forbidden of [secret,"oauth-secret","hidden-secret.example.invalid"])assert.ok(!message.includes(forbidden));
  assert.match(message,/may use API/);
  assert.match(message,/not modified your credentials/);
 });
 it("official API host alone is not misclassified as redirected API endpoint",()=>{
  assert.deepEqual(billingRouteIndicators({ANTHROPIC_BASE_URL:"https://api.anthropic.com/v1"}),[]);
  assert.deepEqual(billingRouteIndicators({ANTHROPIC_BASE_URL:"https://API.ANTHROPIC.COM"}),[]);
 });
 it("malformed or local endpoint triggers warning without disclosing its value",()=>{
  assert.deepEqual(billingRouteIndicators({ANTHROPIC_BASE_URL:"not a url"}),["ANTHROPIC_BASE_URL"]);
  assert.deepEqual(billingRouteIndicators({ANTHROPIC_BASE_URL:"http://127.0.0.1:8877/api"}),["ANTHROPIC_BASE_URL"]);
  assert.ok(!billingRouteNotice({ANTHROPIC_BASE_URL:"http://127.0.0.1:8877/api"}).includes("127.0.0.1"));
 });
 it("false cloud provider toggles do not trigger false positives",()=>{
  const env={CLAUDE_CODE_USE_BEDROCK:"false",CLAUDE_CODE_USE_VERTEX:"0",CLAUDE_CODE_USE_FOUNDRY:"off"};
  assert.deepEqual(billingRouteIndicators(env),[]);
  assert.deepEqual(billingRouteIndicators({...env,CLAUDE_CODE_USE_FOUNDRY:"TRUE"}),["CLAUDE_CODE_USE_FOUNDRY"]);
 });
 it("warnings require populated auth variables",()=>{
  assert.equal(billingRouteNotice({ANTHROPIC_API_KEY:" ",ANTHROPIC_AUTH_TOKEN:""}),undefined);
 });
});
describe("metered Extra Usage classification",()=>{
 it("only SDK's explicit true indicates overage, not a mere rejected quota status",()=>{
  for(const value of [undefined,false,0,"true","false",null]) {
   assert.equal(isUsingExtraUsage({status:"rejected",isUsingOverage:value}),false);
  }
  assert.equal(isUsingExtraUsage({status:"allowed",isUsingOverage:true}),true);
  assert.equal(isUsingExtraUsage({status:"allowed_warning",isUsingOverage:true}),true);
  assert.equal(isUsingExtraUsage(undefined),false);
 });
 it("stop message explains that billing may already have occurred and how to opt in globally",()=>{
  assert.match(EXTRA_USAGE_STOP_MESSAGE,/cannot undo charges already incurred/);
  assert.match(EXTRA_USAGE_STOP_MESSAGE,/global claude-bridge.json/i);
  assert.match(EXTRA_USAGE_STOP_MESSAGE,/allowExtraUsage/);
 });
});
