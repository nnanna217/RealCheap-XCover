# Build Log

Chronological record of how this prototype was built with an LLM coding harness (Claude Code), kept as it happened. Each entry: what was asked, what came back, what was wrong, what was changed by hand.

## 2026-09-12 — Scaffold

- Copied a prior Adyen payments checkout demo (Express + plain HTML/JS: product → checkout → result, server-side API proxy, HMAC-verified webhook handler) into a fresh repo. No Adyen code removed yet — the first commit is the honest starting point so the Adyen → XCover swap is visible in the diffs.
- Added `CLAUDE.md` (Karpathy-inspired guidelines + project context), `.env.example`, this log.
- Manual: nothing generated yet.
