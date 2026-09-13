// Result page logic - reads resultCode from URL query parameters

document.addEventListener('DOMContentLoaded', () => {
    console.log('Result page loaded');

    // Parse URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const resultCode = urlParams.get('resultCode');
    const sessionId = urlParams.get('sessionId');

    console.log('Result Code:', resultCode);
    console.log('Session ID:', sessionId);

    const resultContent = document.getElementById('result-content');

    // Display result based on resultCode
    if (!resultCode) {
        resultContent.innerHTML = `
            <div class="result-error">
                <div class="result-icon">⚠️</div>
                <h2>No Payment Result</h2>
                <p>Unable to determine payment status.</p>
            </div>
        `;
        return;
    }

    // Handle different result codes
    switch (resultCode) {
        case 'Authorised':
            resultContent.innerHTML = `
                <div class="result-success">
                    <div class="result-icon">✓</div>
                    <h2>Payment Successful!</h2>
                    <p>Thank you for your purchase. Your order has been confirmed.</p>
                    <p class="result-details">Session ID: ${sessionId || 'N/A'}</p>
                </div>
            `;
            break;

        case 'Pending':
        case 'Received':
            resultContent.innerHTML = `
                <div class="result-pending">
                    <div class="result-icon">⏳</div>
                    <h2>Payment Pending</h2>
                    <p>Your payment is being processed. We'll notify you once it's complete.</p>
                    <p class="result-details">Session ID: ${sessionId || 'N/A'}</p>
                </div>
            `;
            break;

        case 'Refused':
        case 'Cancelled':
        case 'Error':
            resultContent.innerHTML = `
                <div class="result-error">
                    <div class="result-icon">✗</div>
                    <h2>Payment ${resultCode}</h2>
                    <p>Unfortunately, your payment could not be processed.</p>
                    <p class="result-details">Please try again or use a different payment method.</p>
                </div>
            `;
            break;

        default:
            resultContent.innerHTML = `
                <div class="result-unknown">
                    <div class="result-icon">?</div>
                    <h2>Unknown Status</h2>
                    <p>Payment status: ${resultCode}</p>
                    <p class="result-details">Session ID: ${sessionId || 'N/A'}</p>
                </div>
            `;
    }
});
