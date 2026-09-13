# RealCheap × XCover — protection-plan checkout prototype

Mock RealCheap checkout with an embedded XCover (Cover Genius) protection-plan offer against the XCover staging API. Built for the Cover Genius Senior Client Solutions Engineer case study.

## Run locally

```bash
cp .env.example .env     # then fill in XCOVER_API_KEY and XCOVER_API_SECRET
npm install
npm start                # http://localhost:3000
```

## Layout

- `server.js` — Express: serves `public/`, proxies XCover calls (secrets stay server-side), receives webhooks
- `public/` — catalog, product, checkout, result pages (plain HTML/JS)
- `CLAUDE.md` — the guidelines the coding agent worked under
- `BUILD_LOG.md` — how it was built, what the agent got wrong, what was fixed by hand

## Origin

Scaffolded from a prior Adyen payments checkout demo. Embedded insurance has the same integration shape as embedded payments — server-side secret, quote-or-session, webhook.
