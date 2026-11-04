# Configuration authority and billing safeguards (OMP 18.16.0)

**Version:** `v0.8.2-omp.4` (candidate, 2026-11-05).
**Related review:** [poog26/omp-agent-sdk-bridge](https://github.com/poog26/omp-agent-sdk-bridge), especially its [config hardening](https://github.com/poog26/omp-agent-sdk-bridge/commit/587abb074b9dc8e160503aa95aa1150905e42d32). This is an independently adapted implementation, **not a merge of that fork**.

## 1. P0: configuration authority

The prior bridge merged project `.omp/claude-bridge.json` settings **over** the global agent configuration. A project could override:

- `provider.pathToClaudeCodeExecutable` (run a different executable),
- `provider.strictMcpConfig` (permit filesystem MCP discovery),
- `provider.autoMemoryEnabled` (change persistence behavior),
- context and later billing controls,
- `askClaude.enabled`, `askClaude.defaultMode`, `askClaude.allowFullMode` (broaden delegated tool powers),
- tool name, label and description (untrusted tool descriptions / prompt injection),
- the extension's globally stored first-run notice flags.

**New rule:** the global agent configuration is authoritative for `provider` and all startup notice flags. Project `provider` is **ignored** (with a warning that names the path but never logs its values).

The project `askClaude` object may **only** contain effective constraints that cannot widen the global configuration:

| Project setting | Accepted value | Effect |
|---|---|---|
| `enabled` | `false` | Disable globally enabled AskClaude |
| `allowFullMode` | `false` | Prevent any `full` call |
| `defaultMode` | `none` or `read`, **only when no more permissive** than the global effective default | Reduce default capabilities |
| `defaultIsolated` | `true` | Default to isolated queries (not a mandatory sandbox) |
| `appendSkills` | `false` | Do not forward skills |
| Any other field or locally provided `full`, `enabled:true`, `allowFullMode:true`, `defaultIsolated:false` | Ignored | Cannot change tool metadata or expand permissions |

The effective global default is `read` when unspecified, `none` when configured, and if `allowFullMode:false` forces a configured global `full` down to `read`. A repository cannot raise `none → read` or `read → full` via its local defaults.

**Migration:** move legitimate project-specific `provider` settings into the **global OMP agent** config (`~/.omp/agent/claude-bridge.json`, or the active agent-directory profile's equivalent). A user who wants AskClaude strictly read-only must set `askClaude.allowFullMode:false` globally; merely setting its *default* to `read` does not prohibit an explicit `full` invocation.

## 2. P1: routing warnings without hijacking authentication

The bridge **does not alter, strip, replace or inspect secret values** in Claude Code's authentication environment. It warns once for each routing-indicator set observed before starting a query, and warns again only when the environment changes.

Recognized inherited environment indicators (names only):

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`, when it does not point at the standard `api.anthropic.com` host
- enabled `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`

The warning is displayed in the TUI or written to stderr for headless clients. **Neither credentials nor endpoint values are logged by this feature.** It warns of a **possible** API/cloud billing route, not proof that a particular request was charged. Claude Code may also obtain routing from settings or credentials that are not reflected in inherited environment variables; these are outside this detector's guarantee.

## 3. P1: metered Extra Usage

New global provider config:

```json
{
  "provider": {
    "allowExtraUsage": false
  }
}
```

- **Default (`false`)**: if Claude Code's SDK emits `rate_limit_event.rate_limit_info.isUsingOverage === true`, the bridge reports that **this query is being served as paid Extra Usage**, ends the query and closes its SDK stream. This applies to **all three** SDK paths: ordinary provider turns, AskClaude, and isolated OMP compact/summary turns.
- **Explicit global `true`**: allow the request/continuation and display one warning per query. A project's `allowExtraUsage:true` is ignored.
- Normal `allowed`, `allowed_warning` and `rejected` events **without** `isUsingOverage:true` preserve existing rate-limit and fallback behavior. `rejected` alone is not a billable-overage indicator.

**Limit of protection:** the SDK's `rate_limit_event` is emitted after or during the current API request. By then, that request may have **already incurred a charge**, and an OMP tool may already have completed. This is an explicit stop-after-detection policy, **not a pre-authorization mechanism or a guarantee of zero overage cost**. Configure Anthropic account usage-credit/Extra Usage settings and spending limits for an account-level hard budget.

A rerun can trigger another overage event and end again. The bridge does not automatically disable Anthropic's account-level Extra Usage or route an API account back to a subscription. It does not replace OMP approvals or operating-system permissions.

## Verification

- `tests/unit-project-config-security.mjs`: malicious project provider and AskClaude attempts, global restrictions, malformed values, notice marker protection.
- `tests/unit-billing-guard.mjs`: route classification, false toggles, standard Anthropic API endpoint, zero secret leakage and exact overage classification.
- `tests/unit-extra-usage-sdk-paths.mjs`: AskClaude and isolated summaries stop/continue correctly on SDK overage signals.
- `tests/smoke-omp-config-billing.mjs`: real OMP CLI + controlled SDK, 7 scenarios; no network, API keys or paid usage.
- `tests/smoke-omp-overage-tools.mjs`: overage arrives **after** an authorized `read`; `write` is never sent without global opt-in. With global opt-in, both tools complete. OMP/MCP real, SDK controlled.
- Existing OMP security gate, fallback, glyph, sessions and compaction suites must remain green.

Reproduce:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:unit
OMP_BIN="$(mise where 'github:can1357/oh-my-pi')/omp" bun run test:smoke
```

**Sources:** Anthropic Claude Help Center documents that API key / cloud-service billing can be pay-as-you-go, and that optional usage credits allow continued service beyond the subscribed usage allowance. Event shape was verified against existing SDK trace fixtures and Claude Code's reported `isUsingOverage` boolean. No promise is made regarding legal classification, plan entitlements or actual charges beyond these stated limits.
