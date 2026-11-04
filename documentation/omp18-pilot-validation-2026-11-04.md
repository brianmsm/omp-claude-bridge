# OMP bridge compatibility pilot

Date: 2026-11-04. Branch: `maint/omp18-pr12-quota-fix-20261104`.

## Provenance and upstreams

- Based on [DevVig/omp-claude-bridge PR #12](https://github.com/DevVig/omp-claude-bridge/pull/12) at commit `dcde834091bbccaf8f6ccee6c2326abfe4377948`, proposed by `dmytroleonenko`.
- That port incorporates work from [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge). See the existing `LICENSE`, `NOTICE`, and `documentation/upstream-sync-2026-10-23.md`.
- This maintenance branch adds a narrow OMP-specific fix and a unit regression for exhausted-subscription fallback behavior. It is **not** an official release of either upstream project.

## Verified against OMP 18.16.0

- Bun 1.4.4 and Claude Agent SDK 0.3.308.
- PR #12 without patch: 379 passing unit tests, 46 suites; TypeScript and offline OMP CLI smoke passed.
- Manual compaction via OMP RPC using a deliberately small `compaction.keepRecentTokens: 80`: compacted history and resumed a botanical sample conversation, retaining its project name and a fixture file's three words.
- OMP `navigate_tree` with summarization: completed and retained the fictional project name when the conversation continued.
- Original `pi-claude-bridge` at `0b41f78189de09c6da6baf3acc0f604b089f08fb` raised `key.charCodeAt is not a function` in both compact and tree-summary scenarios ([issue #232](https://github.com/elidickinson/pi-claude-bridge/issues/232)).
- Quota failure simulated through the SDK (no real subscription exhaustion): without the patch, an SDK `<synthetic>` notice blocked OMP's `retry.fallbackChains` even when the SDK provided a `five_hour` rejection. The patch keeps that notice in `errorMessage` but excludes it from committed assistant text when a rejection event is present, allowing OMP's mock local fallback to return `FALLBACK_OK` ([issue #195](https://github.com/elidickinson/pi-claude-bridge/issues/195)).
- Patched branch: 380 passing unit tests, 46 suites; TypeScript and offline OMP smoke passed.

## Safety and remaining gaps

**Status: experimental / pilot-ready, not guaranteed stable.**

Real-world use with Claude Code authentication is subject to Anthropic's current terms and account policies. This repository does not bypass authentication or entitlements.

The following remain **unverified** and should be prioritized before relying on this bridge for long-running or security-sensitive workflows:

1. Normal automatic compaction near genuine 200k/1M context thresholds, including cache-reuse fidelity and context correctness on resume.
2. Parallel OMP subagents, interleaved sessions, and cancellations across tool boundaries.
3. CLI shutdown and recovery from aborted/slow/terminated tools, including clean process termination.
4. Permission and hook denial semantics. Do not infer Claude Code's denial rules are enforced on tools executed by OMP.
5. Additional quota error formats that lack `rate_limit_event` and live quota recovery, which was not tested to avoid wasting subscription allowance.
6. Multiple Claude Code accounts and `CLAUDE_CONFIG_DIR` isolation.
7. Future OMP runtime or Claude Agent SDK upgrades.

## Reproducible offline checks

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test:unit
OMP_BIN="$(mise where 'github:can1357/oh-my-pi')/omp" bun run test:smoke
```

These tests use synthetic/controlled SDK data and do not need Claude authentication. The live tests were conducted separately with explicit temporary OMP agent directories and fixture files; their diagnostic logs remain local, not published in this repository.

When upstream PR #12 or the original Pi bridge advances, compare its changed code and unit suites against this branch, preserving the smallest possible OMP-specific delta.
