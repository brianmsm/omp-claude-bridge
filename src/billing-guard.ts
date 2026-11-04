/** Billing-route diagnostics and Extra Usage consent.
 *
 * Route indicators are intentionally *warnings*, not auth overrides. Never
 * copy, remove or log secret values. Claude Code keeps its normal login and
 * other authentication methods unless the user explicitly changes their env.
 *
 * Extra Usage protection can only react once Claude Code emits a rate-limit
 * event; the current API request may already have incurred a charge. The SDK
 * event is the authority for classification, never a guess based on status.
 */
import type { RateLimitInfo } from "./rate-limit.js";

const CLOUD_ROUTES = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

function routeEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && !["false", "0", "no", "off"].includes(normalized));
}

function externalBaseUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    // An explicitly set official API URL alone doesn't redirect requests.
    return new URL(value).hostname.toLowerCase() !== "api.anthropic.com";
  } catch {
    // Malformed URLs may still affect routing. Warn without displaying them.
    return true;
  }
}

export function billingRouteIndicators(env: NodeJS.ProcessEnv): string[] {
  const names: string[] = [];
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const) {
    if (env[key]?.trim()) names.push(key);
  }
  if (externalBaseUrl(env.ANTHROPIC_BASE_URL)) names.push("ANTHROPIC_BASE_URL");
  for (const key of CLOUD_ROUTES) {
    if (routeEnabled(env[key])) names.push(key);
  }
  return names;
}

/** No values/secrets are ever included in user-visible or debug messages. */
export function billingRouteNotice(env: NodeJS.ProcessEnv): string | undefined {
  const names = billingRouteIndicators(env);
  if (!names.length) return undefined;
  return `Claude bridge billing route warning: ${names.join(", ")} ` +
    "is configured. Claude Code may use API, cloud-provider, or custom-endpoint " +
    "billing instead of your Claude subscription. Check the environment " +
    "before sending prompts; the bridge has not modified your credentials.";
}

/** 'rejected' is NOT necessarily Extra Usage; only explicit SDK classification is. */
export function isUsingExtraUsage(info: RateLimitInfo | undefined): boolean {
  return info?.isUsingOverage === true;
}

export const EXTRA_USAGE_STOP_MESSAGE =
  "Claude Code reported that this request is using paid Extra Usage. " +
  "The bridge stopped this query because provider.allowExtraUsage " +
  "is not enabled in your global claude-bridge.json. This prevents further " +
  "work on this turn, but cannot undo charges already incurred by the request. " +
  "To permit Extra Usage, explicitly set provider.allowExtraUsage: true " +
  "in your GLOBAL OMP agent configuration.";
