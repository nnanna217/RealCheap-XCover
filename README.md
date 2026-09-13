# RealCheap × XCover — protection-plan checkout prototype

Mock RealCheap checkout with an embedded XCover (Cover Genius) protection-plan offer against the XCover staging API. Built for the Cover Genius Senior Client Solutions Engineer case study.

## Run locally

```bash
cp .env.example .env
npm install
npm start                # http://localhost:3000
```

**No credentials needed to run it.** `XCOVER_MODE` defaults to `fixture`: every XCover call is built and signed exactly as it would be, but the response comes from `fixtures/offer-response.json` (hand-written from the retail Offers API schema) and the page labels it `fixture`.

To hit the staging API, set in `.env`:

```
XCOVER_MODE=live
XCOVER_API_KEY=…            # from Cover Genius
XCOVER_API_SECRET=…
XCOVER_SCHEMA=…             # retail offer schema identifier, from the CSE
```

The page then labels responses `live`. Nothing else changes — the request shape, the signing, and the UI are identical in both modes.

Manual signed calls: `scripts/xcover-curl.sh POST offers/ '<json>'` (reads `.env`).

## Layout

- `server.js` — Express: serves `public/`, proxies XCover calls (secrets stay server-side), receives XCover webhooks
- `lib/xcover-auth.js` — request signing (HMAC-SHA512 over the `Date` header, per the XCover docs) and inbound webhook verification
- `lib/xcover-client.js` — one `call()` for every XCover endpoint; fixture/live switch, timeout, and the request/response envelope the UI shows (secrets redacted)
- `public/` — catalog (`index.html`), product, checkout, result pages; plain HTML/JS, no build step
- `public/js/products.js` — the three-SKU catalog, shared by browser and server
- `fixtures/` — offer response used in fixture mode
- `CLAUDE.md` — the guidelines the coding agent worked under, plus the brief's goals, the six technical considerations as verifiable goals, non-goals, invariants, and the idempotency rules
- `PROMPTS.md` — every prompt given to the agent, verbatim, in order
- `BUILD_LOG.md` — what each prompt produced, what was wrong, what was fixed by hand
- `TODO.md` — decisions deliberately deferred, with reasons

## Origin

Scaffolded from a prior Adyen payments checkout demo. Embedded insurance has the same integration shape as embedded payments — server-side secret, quote-or-session, webhook.
