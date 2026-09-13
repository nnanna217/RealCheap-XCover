// Catalog page: render every product as a card linking to its product page.

document.addEventListener("DOMContentLoaded", () => {
  const catalog = document.getElementById("catalog");
  catalog.innerHTML = PRODUCTS.map(
    (p) => `
    <a class="catalog-card" href="/product.html?sku=${encodeURIComponent(p.sku)}" data-sku="${p.sku}">
      <img src="${p.image}" alt="${p.name}">
      <h3>${p.name}</h3>
      <p class="catalog-category">${p.category}</p>
      <p class="price">$${p.price.toFixed(2)}</p>
    </a>`
  ).join("");
});
