// Test webhook locally
const http = require('http');

// Sample webhook payload from Adyen
const webhookPayload = {
  "live": "false",
  "notificationItems": [
    {
      "NotificationRequestItem": {
        "amount": {
          "currency": "EUR",
          "value": 4999
        },
        "eventCode": "AUTHORISATION",
        "eventDate": "2024-01-15T10:00:00+01:00",
        "merchantAccountCode": "MakeUpByAliceECOM",
        "merchantReference": "MAKEUP_TEST_123",
        "operations": ["CANCEL", "CAPTURE", "REFUND"],
        "paymentMethod": "visa",
        "pspReference": "TEST_PSP_REF_123",
        "reason": "Test payment",
        "success": "true"
      }
    }
  ]
};

function testWebhook() {
  const data = JSON.stringify(webhookPayload);

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/webhooks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  console.log('Sending test webhook to http://localhost:3000/api/webhooks');
  console.log('Payload:', JSON.stringify(webhookPayload, null, 2));

  const req = http.request(options, (res) => {
    console.log(`\nResponse status: ${res.statusCode}`);

    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });

    res.on('end', () => {
      console.log('Response:', responseData);
    });
  });

  req.on('error', (error) => {
    console.error('Error:', error.message);
  });

  req.write(data);
  req.end();
}

testWebhook();
