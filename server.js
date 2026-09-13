const express = require("express");
const path = require("path");
require("dotenv").config();

// Lazy load Adyen library to avoid blocking server startup
// The @adyen/api-library can take a long time to initialize
let AdyenLibrary = null;
function loadAdyenLibrary() {
  if (!AdyenLibrary) {
    console.log("Loading Adyen library...");
    AdyenLibrary = require("@adyen/api-library");
    console.log("Adyen library loaded successfully");
  }
  return AdyenLibrary;
}

const app = express();
const PORT = process.env.PORT || 3000;

// ======================================
// ADYEN CONFIGURATION
// ======================================
// Create Adyen checkout instance on-demand
function getCheckoutAPI() {
  const { Client, Config, CheckoutAPI } = loadAdyenLibrary();
  const config = new Config();
  config.apiKey = process.env.ADYEN_API_KEY;
  config.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
  config.environment = process.env.ENVIRONMENT;

  const client = new Client({
    apiKey: config.apiKey,
    environment: config.environment,
  });
  return new CheckoutAPI(client);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// CORS middleware - Allow Adyen's checkout to work
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Routes
app.get("/", (req, res) => {
  // Redirect to product page for MakeupShop
  res.redirect("/product.html");
});

// API example route
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date() });
});

// GET /api/config - Return client-side configuration
app.get("/api/config", (req, res) => {
  res.json({
    clientKey: process.env.ADYEN_CLIENT_KEY,
    environment: process.env.ENVIRONMENT.toLowerCase()
  });
});

// ======================================
// ADYEN API ENDPOINTS
// ======================================

// POST /api/sessions - Create Adyen payment session
// This endpoint is called from the checkout page to initialize the Drop-in
app.post("/api/sessions", async (req, res) => {
  console.log("POST /api/sessions called");
  console.log("Request body:", req.body);

  try {
    const { amount, reference, returnUrl } = req.body;

    // Validate required fields
    if (
      !amount ||
      !amount.value ||
      !amount.currency ||
      !reference ||
      !returnUrl
    ) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "amount, reference, and returnUrl are required",
      });
    }

    // Create session request
    const sessionRequest = {
      merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
      amount: {
        value: amount.value,
        currency: amount.currency,
      },
      reference: reference,
      returnUrl: returnUrl,
      countryCode: "NL", // Netherlands - adjust as needed
      shopperLocale: "en-US",
      // Optional: Add line items for better payment method support
      lineItems: [
        {
          quantity: 1,
          amountIncludingTax: amount.value,
          description: "Luxury Matte Foundation",
        },
      ],
    };

    console.log(
      "Creating Adyen session with request:",
      JSON.stringify(sessionRequest, null, 2),
    );

    // Call Adyen Sessions API
    const checkout = getCheckoutAPI();
    const session = await checkout.PaymentsApi.sessions(sessionRequest);

    console.log("Session created successfully:", session.id);

    // Return the session data to the frontend
    res.json({
      id: session.id,
      sessionData: session.sessionData,
    });
  } catch (error) {
    console.error("Error creating Adyen session:", error);
    res.status(500).json({
      error: "Failed to create session",
      message: error.message,
      details: error.response?.data || error,
    });
  }
});

// POST /api/webhooks - Adyen webhook endpoint
// This endpoint receives AUTHORISATION events from Adyen
app.post("/api/webhooks", async (req, res) => {
  console.log("\n=== WEBHOOK RECEIVED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    // Get the notification items from the webhook payload
    const notificationRequestItems = req.body.notificationItems;

    if (!notificationRequestItems) {
      console.error("No notification items found in webhook");
      console.error("Full request body:", req.body);
      return res.status(400).send("Invalid webhook payload");
    }

    // Process each notification item
    for (const notificationRequestItem of notificationRequestItems) {
      const notification = notificationRequestItem.NotificationRequestItem;

      console.log("\n--- Notification Details ---");
      console.log("Event Code:", notification.eventCode);
      console.log("Merchant Reference:", notification.merchantReference);
      console.log("PSP Reference:", notification.pspReference);
      console.log("Success:", notification.success);
      console.log("Payment Method:", notification.paymentMethod);
      console.log("Amount:", notification.amount);

      // HMAC Validation (Important for production!)
      // Note: You need to add ADYEN_HMAC_KEY to your .env file
      // You can get this from your Adyen Customer Area under Developers > Webhooks
      if (process.env.ADYEN_HMAC_KEY) {
        try {
          const { hmacValidator } = loadAdyenLibrary();
          const validator = new hmacValidator();
          const hmacKey = process.env.ADYEN_HMAC_KEY;

          console.log("Validating HMAC...");
          console.log("HMAC Key length:", hmacKey.length);

          const isValid = validator.validateHMAC(notification, hmacKey);

          if (!isValid) {
            console.error("HMAC validation failed! Potential security issue.");
            console.error("Notification data:", JSON.stringify(notification, null, 2));
            // In production, reject the webhook if HMAC validation fails
            return res.status(401).send("HMAC validation failed");
          }
          console.log("HMAC validation: PASSED ✓");
        } catch (hmacError) {
          console.error("HMAC validation error:", hmacError.message);
          console.error("Stack:", hmacError.stack);
          return res.status(401).send("HMAC validation error");
        }
      } else {
        console.warn(
          "⚠️  WARNING: ADYEN_HMAC_KEY not set - HMAC validation skipped",
        );
        console.warn("⚠️  Add ADYEN_HMAC_KEY to .env for production use");
      }

      // Log AUTHORISATION events
      if (notification.eventCode === "AUTHORISATION") {
        console.log("\n🎉 AUTHORISATION EVENT RECEIVED!");
        console.log(
          "Payment Status:",
          notification.success ? "SUCCESS ✓" : "FAILED ✗",
        );
        console.log("Order Reference:", notification.merchantReference);
        console.log(
          "Payment Amount:",
          `${notification.amount.currency} ${notification.amount.value / 100}`,
        );

        // Here you would typically:
        // 1. Update order status in your database
        // 2. Send confirmation email to customer
        // 3. Trigger fulfillment process
        // Example:
        // await updateOrderStatus(notification.merchantReference, notification.success);
      }

      console.log("========================\n");
    }

    // Always return [accepted] to acknowledge receipt
    // This tells Adyen to stop retrying this webhook
    res.status(200).send("[accepted]");
  } catch (error) {
    console.error("Error processing webhook:", error);
    // Return 500 so Adyen will retry the webhook
    res.status(500).send("Error processing webhook");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
