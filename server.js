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
  const { sku, qty = 1, country = "US", currency = "USD", language = "en" } = req.body || {};
  const product = findProduct(sku);
  if (!product) return res.status(400).json({ error: "unknown or missing sku", sku });
  const quantity = Math.max(1, parseInt(qty, 10) || 1);

  const offerRequest = {
    customer: { language, currency, country },
    // PROVISIONAL: the real field names are set by the E3CCM offer schema (requested from the CSE).
    // Shape chosen to carry what any retail rating needs: what it is, what it cost, how many.
    context: {
      items: [{ sku: product.sku, name: product.name, category: product.category, unit_price: product.price, quantity }],
      order_total: Number((product.price * quantity).toFixed(2)),
    },
    // RealCheap's own order reference — the natural key a retry must reuse so a re-sent request can't double-issue.
    partner: { transaction_id: `RC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase() },
  };

  const envelope = await xcover.call("POST", "offers/", offerRequest, "offer-response.json");
  res.status(envelope.ok ? 200 : 502).json(envelope);
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
