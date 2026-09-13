# Build Log

Chronological record of how this prototype was built with an LLM coding harness (Claude Code), kept as it happened. Each entry: what was asked, what came back, what was wrong, what was changed by hand.

## 2026-09-12 — Scaffold

- Copied a prior Adyen payments checkout demo (Express + plain HTML/JS: product → checkout → result, server-side API proxy, HMAC-verified webhook handler) into a fresh repo. No Adyen code removed yet — the first commit is the honest starting point so the Adyen → XCover swap is visible in the diffs.
- Added `CLAUDE.md` (Karpathy-inspired guidelines + project context), `.env.example`, this log.
- Manual: nothing generated yet.

## 2026-09-12 — Auth + first call attempt (manual, no agent)

- **Auth scheme confirmed from the official docs** (partner-docs.covergenius.com → Authentication): sign only the string `date: <RFC 1123 date>` with HMAC-SHA512, base64 (strict, not url-safe), URL-encode, send as `Authorization: Signature keyId="…",algorithm="hmac-sha512",signature="…"` plus `Date` and `X-Api-Key`. The OpenAPI blurb says "e.g. HMAC-SHA256 of method, path and date" — the reference implementations sign **date only, SHA-512**. Followed the code, not the blurb.
- Wrote `lib/xcover-auth.js` by hand, verified byte-for-byte against the docs' Python/Postman examples. `scripts/xcover-curl.sh` wraps it for manual calls.
- **Blocked:** `https://api.xcover-staging.com` accepts the TCP connection, then never answers the TLS Client Hello (curl 28/35, openssl s_client silent). DNS fine (18.204.152.241), port 80 answers 204, prod `api.xcover.com` and the docs host reachable from the same machine. Reproduced with the tool sandbox disabled. Reads as an IP allowlist on staging — public IP at the time: 24.89.124.89. Asked Cover Genius.
- Request shape learned: schema-driven (`schema`, `customer{language,currency,country}`, `context{…partner schema…}`, optional `partner{}`); response carries offer `id`, `session_id`, `products[]` each with quote `id`, finance breakdown, PDS URL; confirm at `offers/{id}/confirm/`, decline at `offers/{id}/opt_out/`, cancel via `bookings/{id}/cancel`. The retail page says sample requests for this vertical come from the CSE — the `E3CCM` schema has to be asked for.
