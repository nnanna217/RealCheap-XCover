// Product page: render the product named by ?sku= and hand off to checkout.

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("product");
  const sku = new URLSearchParams(window.location.search).get("sku");
  const product = findProduct(sku);

  if (!product) {
    container.innerHTML = `<p class="error-message">Unknown product "${sku || ""}". <a href="/">Back to catalog</a></p>`;
    return;
  }

  document.title = `${product.name} — RealCheap`;
  container.innerHTML = `
    <div class="product-image-carousel">
      <div class="carousel-main">
        <img id="mainImage" src="${product.image}" alt="${product.name}">
      </div>
    </div>
    <div class="product-details">
      <h2>${product.name}</h2>
      <p class="catalog-category">${product.category} · SKU ${product.sku}</p>
      <p class="product-description">${product.description}</p>
      <div class="product-price"><span class="price">$${product.price.toFixed(2)}</span></div>
      <button type="button" id="buyNowBtn" class="buy-now-btn">Buy Now</button>
    </div>`;

  document.getElementById("buyNowBtn").addEventListener("click", () => {
    window.location.href = `/checkout.html?sku=${encodeURIComponent(product.sku)}&qty=1`;
  });
});
