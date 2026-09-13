const express = require("express");
const path = require("path");
require("dotenv").config();
const { verifyXcoverWebhook } = require("./lib/xcover-auth");
const xcover = require("./lib/xcover-client");
const { findProduct } = require("./public/js/products");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", (req, res) => {
  // Redirect to product page for MakeupShop
});

// API example route
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date() });
});

// POST /api/offers - create an XCover offer for the cart
// Body: { sku, qty, country, currency, language }. Price and category come from the catalog, never the client.
app.post("/api/offers", async (req, res) => {
  const { sku, qty = 1, country = "US", currency = "USD", language = "en", transaction_id } = req.body || {};
  const product = findProduct(sku);
  if (!product) return res.status(400).json({ error: "unknown or missing sku", sku });
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  // Idempotency rule 1: one order reference per cart. The browser sends back the one it was given;
  // a new one is minted only when the cart has none yet. Never regenerate on re-quote, reload or retry.
  const txn = /^RC-[A-Z0-9-]{6,}$/.test(transaction_id || "")
    ? transaction_id
    : `RC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

  // Request shape: partner-docs.covergenius.com/offers/vertical-examples/product-retail/create-offer
  // (the schema Cover Genius pointed to). `schema` names server-side config on the partner; if omitted the
  // partner's default schema is used, so it is only sent when XCOVER_SCHEMA is set. A 422
  // `offer_validation_schema_required` from staging is the signal to ask the CSE for the identifier.
  const offerRequest = {
    ...(process.env.XCOVER_SCHEMA ? { schema: process.env.XCOVER_SCHEMA } : {}),
    customer: { language, currency, country },
    context: {
      purchase_date: new Date().toISOString(),
      product: {
        sku: product.sku,
        title: product.name,
        category: product.category,
        quantity,
        condition: "new",
        description: product.description,
        retail_value: product.price,
      },
    },
    // RealCheap's own order reference — the natural key a retry must reuse so a re-sent request can't double-issue.
    partner: { transaction_id: txn },
  };

  const envelope = await xcover.call("POST", "offers/", offerRequest, "offer-response.json");
  res.status(envelope.ok ? 200 : 502).json({ ...envelope, transaction_id: txn });
});

// POST /api/webhooks - XCover webhook endpoint
// XCover signs each delivery with the key/secret pair the partner registers via their CSE,
// and retries up to 3 times on a non-200 response.
app.post("/api/webhooks", async (req, res) => {
  console.log("\n=== WEBHOOK RECEIVED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    // Signature validation (Important for production!)
    // XCOVER_WEBHOOK_KEY / XCOVER_WEBHOOK_SECRET are the pair you give your CSE when registering the listener URL.
    if (process.env.XCOVER_WEBHOOK_SECRET) {
      const result = verifyXcoverWebhook(
        req.headers,
        process.env.XCOVER_WEBHOOK_SECRET,
      );
      if (!result.ok) {
        console.error("Signature validation failed:", result.reason);
        return res.status(401).send("Signature validation failed");
      }
      console.log("Signature validation: PASSED ✓");
    } else {
      console.warn(
        "⚠️  WARNING: XCOVER_WEBHOOK_SECRET not set - signature validation skipped",
      );
      console.warn("⚠️  Add XCOVER_WEBHOOK_SECRET to .env for production use");
    }

    // Here you would typically:
    // 1. Update order / policy status in your database
    // 2. Notify the customer
    // Example:
    // await updatePolicyStatus(req.body);

    console.log("========================\n");

    // Always return 200 to acknowledge receipt
    // This tells XCover to stop retrying this webhook
    res.status(200).send("[accepted]");
  } catch (error) {
    console.error("Error processing webhook:", error);
    // Return 500 so XCover will retry the webhook
    res.status(500).send("Error processing webhook");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
