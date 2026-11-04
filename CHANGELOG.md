# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.2-omp.4] - 2026-11-05

### Security
- Project `.omp/claude-bridge.json` no longer overrides global `provider` settings or notice flags. A project may only **narrow** AskClaude defaults/permissions, never enable it or widen `none → read` / `read → full`, alter tool identity, or enable full mode.
- Add secret-redacted warnings when inherited Claude Code environment variables indicate possible API, cloud-provider or custom-endpoint billing, without changing credentials or disabling login routes.
- **Stop when the SDK explicitly reports paid Extra Usage** (`rate_limit_info.isUsingOverage === true`) unless global `provider.allowExtraUsage: true` opts in. Applies to provider turns, AskClaude and isolated summaries. This cannot refund already incurred charges.

### Verification
- New P0/P1 config security and billing unit suites, three-SDK-path regression tests, and actual OMP CLI integration for malicious project configs, warnings, both overage policies and an event arriving after a native read.
- [Configuration and billing scope, limitations and reproduction](documentation/config-billing-hardening-2026-11-05.md).

## [0.8.2-omp.3] - 2026-11-04

### Security
- **Fix:** a model-proposed OMP tool call is no longer executed until Claude Code issues the matching MCP `tools/call` after permission checks. This prevents CC `permissions.deny` and `PreToolUse` rejections from triggering native OMP side effects ([upstream issue #218](https://github.com/elidickinson/pi-claude-bridge/issues/218)).
- Validate tool-use id, name, and exact argument object; reject stale, duplicate, incomplete, unauthorized, or altered requests. Retain sibling proposals for staggered approvals across OMP tool-result turns.

### Verification
- 48 unit suites / 395 tests; typecheck and CLI smoke suite.
- 7 additional controlled-SDK OMP CLI cases: denied, missing approval, allowed, staggered dual approval, mixed deny/allow, argument mismatch, duplicate MCP call.
- Real Claude Code 2.1.318 / OMP 18.16.0: both `permissions.deny` and `PreToolUse` prevent native OMP write; normal write and staggered dual reads complete.
- [Security design, limits, and test reproduction](documentation/security-dispatch-gate-2026-11-04.md).

## [0.8.2-omp.2] - 2026-11-04

### Fixed
- Adapt OMP private-use glyph-token encoding during system-prompt capture and Claude Code projection, based on Laurens Bosscher's original fix (commit 9236fce).
- Handle exhausted Claude Code subscription notices that arrive without `rate_limit_event`, while preserving fallback behavior for explicit five-hour rejections.

### Verification
- 47 unit suites and 383 tests.
- Controlled OMP CLI smoke covers the standard provider path, private-use glyphs, and three quota-fallback message formats without real Claude API requests.
- Live OMP 18.16.0 pilot exercised concurrent task subagents, OMP hook denial, repeated automatic compaction with reduced threshold, and abort/recovery of a slow bash tool. This does not guarantee all 200K/1M limits or account policies.
- See [expanded pilot report](documentation/pilot-expanded-2026-11-04.md).

## [Unreleased]

### Changed
- Ported the complete pi-claude-bridge runtime through 2026-10-23 (`6aa276a`,
  version 0.9.3 plus subsequent fixes), including its stream/session regression suite.
- Updated to Agent SDK 0.3.308 and cc-session-io 0.4.0; target OMP >=18.13.2.
- Preserve OMP prompt blocks, native tool schemas and parent/child session state;
  route native summaries to the correct session directory even concurrently.
- Derive models from OMP's catalog while retaining the 1M/200K picker variants.
  Automatic context routing follows upstream's current measured model table.
- AskClaude is opt-in and deprecated; Claude Code auto-memory defaults to off.
  Retired `appendSystemPrompt`/`settingSources` in favor of OMP's effective prompt.
- Run isolated regression suites and the actual OMP CLI smoke in Bun/CI.

See [migration and verification details](documentation/upstream-sync-2026-10-23.md).

## [0.8.1] - 2026-07-07

### Fixed
- Spurious "Claude rate limit warning" toasts at trivial utilization. The Claude
  Agent SDK emits `allowed_warning` rate-limit events even at ~1% of the
  `seven_day` (weekly) limit; these are now surfaced only at ≥80% utilization.
  Hard-limit (`rejected`) notifications and the debug log are unchanged.

## [0.8.0] - 2026-07-07

### Added
- On-demand context-window variants in the `/model` picker: each model is now
  registered once per window it supports (1M and/or 200K) as a distinct,
  clearly-labeled entry (e.g. `Opus 4.8 (1M)` and `Opus 4.8 (200K)`). Switching
  a model's context window is a picker selection instead of a config edit plus
  reload.
- Suffixed model ids (`<model>-1m` / `<model>-200k`) that force a specific
  window regardless of the global default — usable from `modelRoles` and
  AskClaude short names. The unsuffixed id remains the config default, so
  existing `config.yml` roles keep working.

### Changed
- `provider.contextWindow` now sets the **default** window (which window the
  unsuffixed model id maps to) instead of hiding models that don't match it.
  Both windows stay pickable wherever a runtime exists.
- Each variant reports its true `contextWindow`, keeping the status bar and
  auto-compaction accurate for the selected window.

## [0.7.0] - 2026-07-06

First public release of the Oh My Pi port.

### Added
- `provider.contextWindow` setting with three modes:
  - `"auto"` (default) — per-model context policy based on measured SDK behavior.
  - `"1m"` — force the 1M context window; only 1M-capable models are registered.
  - `"200k"` — force the 200K context window; only 200K-capable models are registered.
- Models without a runtime for the selected forced window are hidden from the
  model picker instead of being misreported.
- `thinkingLevelMap` fallback so Sonnet 5 / Sonnet 4.6 expose `xhigh` (mapped to `max`).

### Changed
- Ported from Pi (`@earendil-works/*`) to Oh My Pi (`@oh-my-pi/*`): extension
  manifest (`omp.extensions`), provider registration, message conversion, and
  config directory resolution (`~/.omp/agent/claude-bridge.json`).
- Corrected the `claude-fable-5` context policy: the bare `claude-fable-5`
  runtime serves 200K (verified), while `claude-fable-5[1m]` serves 1M. In
  `"auto"` mode Fable 5 now registers at 200K.

### Credits
- Original `pi-claude-bridge` by [Eli Dickinson](https://github.com/elidickinson).
- Oh My Pi port and context-window controls by [Jonathan Borgwing](https://github.com/DevVig).
