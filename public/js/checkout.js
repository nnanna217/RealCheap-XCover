// Checkout page logic

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Checkout page loaded");

  try {
    // First, fetch the client configuration from the server
    const configResponse = await fetch("/api/config");
    if (!configResponse.ok) {
      throw new Error("Failed to load configuration");
    }
    const config = await configResponse.json();
    console.log("Configuration loaded:", {
      environment: config.environment,
      hasClientKey: !!config.clientKey
    });

    // Call the sessions API endpoint on page load
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: {
          value: 4999, // Amount in cents (€49.99)
          currency: "EUR",
        },
        reference: "MAKEUP_" + Date.now(),
        returnUrl: `${window.location.origin}/result.html`,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create session");
    }

    const session = await response.json();
    console.log("Session created:", session);

    // Initialize Adyen Drop-in with the session
    const configuration = {
      session: {
        id: session.id,
        sessionData: session.sessionData,
      },
      clientKey: config.clientKey, // Loaded from server
      environment: config.environment, // Loaded from server
      onPaymentCompleted: (result, component) => {
        console.log("Payment completed:", result);
        // Redirect to result page with session info
        window.location.href = `/result.html?sessionId=${session.id}&resultCode=${result.resultCode}`;
      },
      onError: (error, component) => {
        console.error("Payment error:", error);
        document.getElementById("dropin-container").innerHTML =
          '<p class="error-message">Payment error: ' + error.message + "</p>";
      },
      // Customize payment methods styling
      paymentMethodsConfiguration: {
        card: {
          hasHolderName: true,
          holderNameRequired: true,
          billingAddressRequired: false,
        },
      },
    };

    // Create and mount the Drop-in
    const checkout = await AdyenCheckout(configuration);
    checkout.create("dropin").mount("#dropin-container");
  } catch (error) {
    console.error("Error initializing checkout:", error);
    document.getElementById("dropin-container").innerHTML =
      '<p class="error-message">Failed to initialize checkout. Please try again.</p>';
  }
});
