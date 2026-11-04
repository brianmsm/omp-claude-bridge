# Security gate for OMP-native tools exposed via Claude Code MCP

**Version:** `0.8.2-omp.3`
**Target:** OMP 18.16.0, Claude Code 2.1.318, Agent SDK 0.3.308
**Related upstream:** [elidickinson/pi-claude-bridge#218](https://github.com/elidickinson/pi-claude-bridge/issues/218)

## Threat model and original failure

The extension runs Claude Code as the model provider but executes the served tools in **Oh My Pi**. Previously, on Claude's streamed `tool_use`, the bridge emitted `toolcall_start/end` immediately and ended the OMP stream. OMP executed the tool before Claude Code evaluated its own `permissions.deny` / `PreToolUse` hooks.

When Claude Code rejected a proposed call locally, the CLI never made its `MCP tools/call` request; the bridge still executed the native tool. With `--approval-mode=yolo`, a rejected `write` produced a file, while Claude Code later told the user that it was blocked. Reproduced with a real Claude Code project hook, not merely a fake SDK.

## Corrected authorization boundary

**Never execute a native OMP tool from model-streamed content alone.**

1. The stream's tool-use id, served tool name, and JSON arguments are staged as an **untrusted proposal**, without emitting an OMP tool event.
2. After Claude Code's local permission rules and `PreToolUse` hooks, its **MCP tools/call** request is received by `src/mcp-server.ts`.
3. The bridge checks that the received request matches a **completed** model proposal by **id, tool name, and full argument object**. Unknown, incomplete, duplicate, stale, and altered requests **fail closed**, returning MCP `isError:true` without dispatch.
4. Only a matching MCP request can authorize emission of OMP `toolcall_start/end`. OMP continues to enforce **its own** approval mode and `tool_call` hook restrictions.
5. Claude Code can authorize two proposed calls in series, even when the model proposed them concurrently. The bridge retains not-yet-authorized proposals across OMP tool-result turns and dispatches each when its matching MCP request arrives; it never silently runs an unapproved sibling.
6. A Claude Code-generated `tool_result` with `is_error:true` for a locally refused proposal removes that proposal. Abort, query shutdown, and session rewrite release pending handlers, cancel dispatch timers, and clear their state.
7. SDK assistant-message echoes that repeat an already streamed message id are not re-staged.

This is a coordination fix between two tool runtimes, **not** a way to bypass Claude Code permissions. A request rejected by Claude Code is not executed by OMP.

## Verified locally

**Real Claude Code 2.1.318 + real OMP 18.16.0:**

- A project `PreToolUse` hook rejected `write`: no OMP tool execution and no file created.
- A project `permissions.deny` rule rejected `write`: no OMP tool execution and no file created.
- An allowed `write` created exactly one file with the expected content.
- A mixed workload allowed `read` and denied `write`: only `read` executed; denied file absent.
- Two proposed reads received staggered MCP authorizations. OMP executed both exactly once in the order authorized, and the response contained both files' data.

**Automated OMP CLI smoke, controlled SDK and local MCP server (no Anthropic traffic):**

| Scenario | Expected OMP side effects |
|---|---|
| Denied by SDK, no MCP authorization | 0 |
| Unacknowledged proposed tool | 0 |
| One authorized `write` | 1 |
| Two authorized `write` operations, staggered | 2 |
| Approved and denied tools mixed | Only 1 |
| Modified MCP argument object | 0; MCP error |
| Duplicate `tools/call` for same id | Only 1; second MCP error |

**Unit suite:** 48 suites, 395 tests, including 12 dispatch-state-machine regressions. Existing recorded stream tests were updated to explicitly emulate **the MCP authorization step**; their previous assumption that a tool-use proposal itself was executable was no longer correct.

## Limitations and defense in depth

- The authorization gate applies to **tools bridged from OMP via the Claude Code MCP server**. It does not redefine the permissions of Claude Code's native tools in AskClaude mode, unrelated OMP plugins, or separate external MCP servers.
- It relies on Claude Code invoking MCP tools/call **after** applying its configured permission rules and hooks, as observed in Claude Code 2.1.318. Updates to Claude Code/SDK or OMP should rerun the security smoke tests and a real denied-tool test.
- The gate intentionally rejects hook-transformed tool input when the final MCP arguments do not match the streamed proposal. This protects against executing a different operation, but may need a reviewed contract if transformed arguments become supported.
- With `--approval-mode=yolo`, OMP still allows any operation that Claude Code explicitly authorizes. Do not confuse an authorization handshake with full sandboxing. For unattended or privileged work use **OMP-side hooks/approval policy, OS permissions, and preferably sandbox isolation**. Do not give unrestricted sudo to the agent on the basis of this extension.
- No guarantee is made that *every* error race, extension combination, model version, or subscription entitlement has been tested. Continue to monitor the upstream issue.

## Reproduce

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test:unit
OMP_BIN="$(mise where 'github:can1357/oh-my-pi')/omp" bun run test:smoke
```

The authorization smoke is `tests/smoke-omp-authorization.mjs`. It drives the **actual OMP CLI and the bridge's real in-process MCP transport**, with deterministic SDK messages. Every file mutation is inside a temporary test folder that is deleted when the test ends.

**Rollback:** the previous stable candidate `v0.8.2-omp.2` remains available; it **does not contain this security fix** and must not be used for unattended permissions-sensitive workloads.
