const express = require("express");
const path = require("path");
require("dotenv").config();
const { verifyXcoverWebhook } = require("./lib/xcover-auth");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", (req, res) => {
  // Redirect to product page for MakeupShop
  res.redirect("/product.html");
});

// API example route
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date() });
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
      const result = verifyXcoverWebhook(req.headers, process.env.XCOVER_WEBHOOK_SECRET);
      if (!result.ok) {
        console.error("Signature validation failed:", result.reason);
        return res.status(401).send("Signature validation failed");
      }
      console.log("Signature validation: PASSED ✓");
    } else {
      console.warn("⚠️  WARNING: XCOVER_WEBHOOK_SECRET not set - signature validation skipped");
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
