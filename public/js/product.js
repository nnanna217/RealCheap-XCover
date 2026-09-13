// Product page logic

document.addEventListener('DOMContentLoaded', () => {
    // ======================================
    // Image Carousel Functionality
    // ======================================
    const mainImage = document.getElementById('mainImage');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const thumbnails = document.querySelectorAll('.thumbnail');

    // Array of image sources
    const images = [
        '/images/foundation/flawless-finish-foundation.png',
        '/images/foundation/flawless-finish-foundation-variation-1.png',
        '/images/foundation/flawless-finish-foundation-variation-2.png',
        '/images/foundation/flawless-finish-foundation-variation-3.png',
        '/images/foundation/flawless-finish-foundation-close-up-angle.png',
        '/images/foundation/flawless-finish-foundation-overhead-flatlay.png'
    ];

    let currentIndex = 0;

    // Function to update main image and active thumbnail
    function updateImage(index) {
        // Update current index
        currentIndex = index;

        // Update main image
        mainImage.src = images[currentIndex];

        // Update active thumbnail
        thumbnails.forEach((thumb, i) => {
            if (i === currentIndex) {
                thumb.classList.add('active');
            } else {
                thumb.classList.remove('active');
            }
        });
    }

    // Previous button click
    prevBtn.addEventListener('click', () => {
        const newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
        updateImage(newIndex);
    });

    // Next button click
    nextBtn.addEventListener('click', () => {
        const newIndex = currentIndex === images.length - 1 ? 0 : currentIndex + 1;
        updateImage(newIndex);
    });

    // Thumbnail clicks
    thumbnails.forEach((thumbnail) => {
        thumbnail.addEventListener('click', () => {
            const index = parseInt(thumbnail.getAttribute('data-index'));
            updateImage(index);
        });
    });

    // Optional: Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            prevBtn.click();
        } else if (e.key === 'ArrowRight') {
            nextBtn.click();
        }
    });

    // ======================================
    // Buy Now Button
    // ======================================
    const buyNowBtn = document.getElementById('buyNowBtn');

    buyNowBtn.addEventListener('click', () => {
        // Navigate to checkout page
        window.location.href = '/checkout.html';
    });
});
