# OMP 18.16.0: expanded functional pilot and upstream triage

**Date:** 2026-11-04. **Candidate:** `0.8.2-omp.2`. **Status:** experimental, not guaranteed for all workloads.

## Provenance and branch policy

The maintained fork [brianmsm/omp-claude-bridge](https://github.com/brianmsm/omp-claude-bridge) is based on [DevVig PR #12](https://github.com/DevVig/omp-claude-bridge/pull/12), head `dcde834091bbccaf8f6ccee6c2326abfe4377948`.

GitHub's “2 behind” comparison with DevVig `main` refers only to these two commits after the PR #12 merge base `fd403e4`:

- [9087897](https://github.com/DevVig/omp-claude-bridge/commit/908789724c7417ea4e678fa4bc47a741f8bd2355): switches CI to a maintainer-specific runner (`namespace-profile-vig`). Not appropriate for a portable fork.
- [fab4d93](https://github.com/DevVig/omp-claude-bridge/commit/fab4d93edb6f54a0881d0bbdaac921aacb3a070e): adds GitHub Actions `concurrency/cancel-in-progress`. Optional; not a functional bridge correction, intentionally not merged.

The parallel fork [LaurensBosscher/omp-claude-bridge](https://github.com/LaurensBosscher/omp-claude-bridge) incorporates an earlier PR #12 snapshot and then introduces [9236fce](https://github.com/LaurensBosscher/omp-claude-bridge/commit/9236fcef201b12a99e8c26a3ee3e760ba85df34d), which handles OMP private-use glyph encoding. Its merge is missing the later PR #12 empty-rebuild guard and two tests; **do not merge Laurens's tree as a whole**. The glyph commit was individually cherry-picked with `-x`, retaining Laurens's authorship, and validated on the maintained fork.

## Environment and isolation

- OMP **18.16.0** managed by mise.
- Bun **1.4.4**, Node **26.12.0**, Claude Code **2.1.317**, Agent SDK **0.3.308**.
- Worktree for research: sibling to this document under `advanced/audit-20261104-laurens/glyph-and-pilot`.
- Logs and experiment data: `../logs` relative to the worktree's containing `audit-20261104-laurens` directory. Nothing was installed into the user's normal OMP plugin profile.
- **Real-model tests** used an existing Claude Code subscription login and consumed some allowance. **SDK-controlled tests** used no real Anthropic queries. Files and tool invocations were confined to the test directory.

## Results

| Scenario | Method | Observed result | Limits |
|---|---|---|---|
| Original bridge glyph prompt with private-use Unicode | Actual OMP CLI + controlled SDK | **FAIL** before modification: `prompt-capture: no capture`; SDK not called | Reproducible on OMP 18.16.0 |
| Same glyph scenario after Laurens 9236fce | Actual OMP CLI + controlled SDK | **PASS**: model invoked, encoded glyph notice present, raw PUA glyph count zero, exit 0 | Encoding uses OMP private-use glyph scheme |
| Two parallel OMP subagents | Real Claude Haiku 4.5 + native `task` | **PASS**: two concurrent workers `ReviewFormatDates` and `ReviewSlug`, independent findings and completed `wait` results, exit 0 | Not proof of arbitrary large worker pools or long-lived agent isolation |
| OMP host-level `tool_call` denial | Real Claude Haiku 4.5 + extension hook | **PASS**: native `write` attempted, host returned `PILOT_DENIED_BY_OMP_POLICY`, denied fixture did not appear, exit 0 | Claude Code's separate `permissions.deny` and PreToolUse hooks were **not** tested |
| Automatic compaction, threshold 14,000 tokens | Real Claude Haiku 4.5, OMP RPC, seven turns | **PASS with caution**: eight `compaction` entries persisted; final turn recalled project `Reserva Andina 714` and fixture `alpha beta gamma`; exit 0 | Deliberately aggressive threshold caused repeated compactions; not representative of defaults or 200K/1M entitlement |
| Slow bash cancellation and subsequent turn | OMP RPC + controlled SDK, genuine native bash | **PASS**: bash started; RPC `abort` acknowledged; tool returned `Command aborted`; new prompt answered `RECOVERED_AFTER_ABORT`; no delayed file creation after 15 seconds; exit 0 | Mocked SDK, no real Claude API timeout |
| Quota `five_hour` rejection and synthetic assistant | OMP CLI + controlled SDK + local fallback provider | **PASS**: OMP emitted `retry_fallback_applied` and `retry_fallback_succeeded`, `FALLBACK_OK`; exit 0 | No real quota exhausted |
| Quota text without `rate_limit_event`, with synthetic report | Same | **FAIL before targeted fix**, **PASS after** | Recognition limited to known Claude subscription-exhaustion strings |
| Quota text without `rate_limit_event`, no synthetic report | Same | **FAIL before targeted fix**, **PASS after** | Same |
| Separate Claude Code config profiles, A/B | Two isolated OMP processes + controlled SDK | **PASS**: each SDK child inherited its own distinct `CLAUDE_CONFIG_DIR` | Does not support simultaneous account switching inside a single OMP process |
| Custom tool result `terminate:true` | Controlled bridge SDK and independent direct OMP mock provider | **INCONCLUSIVE**: both repeated or waited instead of ending normally. Direct provider reproduced behavior without bridge, so not attributable to it. | Must confirm current OMP tool-result termination contract before declaring a bridge bug |

### Regression automation

Full unit suite: **47 suites, 383 tests passed**.

The standard `bun run test:smoke` now runs:

1. Original OMP/controlled-SDK CLI provider smoke.
2. Real OMP glyph transformation/capture smoke.
3. Real OMP retry/fallback control with three SDK-simulated quota payloads.

TypeScript passed; no real Claude requests are made by those smoke suites.

## Defect explanation and fixes

**Glyphs:** OMP encodes private-use Unicode glyphs before sending a provider request. A raw capture key no longer matches the encoded prompt, so the bridge refuses the turn. Laurens's patch decodes the prompt for lookup and re-encodes the projected prompt, preserving OMP's `<glyph-tokens>` notice. The original author receives attribution via Git commit and `NOTICE`.

**Quota without a preceding rate event:** Claude Code can produce its subscription warning as text without a preceding `rate_limit_event`. That text neither matched OMP's rate-limit classification nor satisfied its “no committed output” fallback gate. The targeted fix recognizes only known Claude Code subscription-exhaustion notices in failed results and keeps such synthetic notices out of assistant content while preserving the explanatory error in `errorMessage`. This allows `retry.fallbackChains` to proceed. A new pair of unit regressions and three CLI fallback cases covers the observed shapes.

### What remains unverified

- True 200K/1M context-window limits and cache-reuse fidelity at scale; the 14K-token compact scenario was intentionally accelerated.
- Actual Claude Code denial hooks and extension tool rejection behavior; OMP host-side hook rejection worked but does not make Claude Code permission rules authoritative for tools executed by OMP.
- Multiple Claude subscriptions in one process with account-aware provider selection.
- Arbitrary SDK error messages absent rate-limit events; only tested phrases are recognized.
- Long-running idle recap/history mutation with other OMP extensions, release/upgrade behavior, and production concurrency beyond two workers.
- The `terminate:true` OMP tool-result contract remains unclear; do not claim it works or is a bridge regression.

## Reproduce the offline regression gate

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test:unit
OMP_BIN="$(mise where 'github:can1357/oh-my-pi')/omp" bun run test:smoke
```

No GitHub credential, Claude Code token, or local user's real documents are needed for these checks. The retained local audit logs contain only test fixtures and synthetic transcripts.

**Recommendation:** candidate `0.8.2-omp.2` is suitable for **pilot use** with a known rollback tag. Avoid assuming perfect security semantics or uninterrupted multi-day operation. Keep upstream PR #12 and the original Pi bridge under review; integrate fixes individually with tests rather than syncing an entire unrelated fork tree.
