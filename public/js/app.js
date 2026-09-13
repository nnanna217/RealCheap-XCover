// Main application JavaScript

document.addEventListener('DOMContentLoaded', () => {
    console.log('Demo Project loaded successfully!');

    // Status button click handler
    const statusBtn = document.getElementById('statusBtn');
    const statusResult = document.getElementById('statusResult');

    if (statusBtn) {
        statusBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();

                statusResult.innerHTML = `
                    <strong>Status:</strong> ${data.status}<br>
                    <strong>Timestamp:</strong> ${new Date(data.timestamp).toLocaleString()}
                `;
                statusResult.classList.add('show');
            } catch (error) {
                statusResult.innerHTML = `<strong>Error:</strong> ${error.message}`;
                statusResult.classList.add('show');
                console.error('Error fetching status:', error);
            }
        });
    }
});
