# Prompt Log

Every prompt given to the coding agent, verbatim, in order. Pairs with `BUILD_LOG.md` (what happened) — this file is only *what was asked*. Entry numbers match between the two files.

## P1 — 2026-09-13 — Strip Adyen

> Remove @adyen/api-library and the Drop-in session flow from server.js and public/js/checkout.js. Keep the Express setup, static serving, and the /api/webhooks HMAC handler. Verify: npm start boots, / serves, no adyen string remains in git grep.
>
> Note — even though I am deciding to strip Adyen for now, if I have time I would re-add it.

## P2 — 2026-09-13 — Catalog

> Replace the products with three RealCheap SKUs in a products.js module: 2 unbranded laptops at $349 and $549, 1 $4 laptop sleeve. Each has sku, name, category, price, image. Verify: index.html lists all three. Also, let product.html?sku= navigate to the respective product.

## P3 — 2026-09-13 — Offer proxy, fixture mode

> Add POST /api/offers that builds an XCover create-offer request from the cart (customer{currency, language, country}, context{…}, partner{transaction_id}) and, when XCOVER_MODE=fixture, returns fixtures/offer-response.json. When XCOVER_MODE=live, POST to ${XCOVER_BASE_URL}/${XCOVER_PARTNER_CODE}/offers/ with headers from lib/xcover-auth.js. Verify: curl -X POST localhost:3000/api/offers returns the fixture with mode: 'fixture' in the envelope.
