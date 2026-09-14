// RealCheap catalog. Prices are USD; other currencies come from the offer response, not from here.
// Loaded in the browser as a global (PRODUCTS) and require()-able from server.js.
const PRODUCTS = [
  {
    sku: "RC-LT-349",
    name: '14" Laptop — 8GB / 256GB SSD',
    brand: "Unbranded",
    model: "RC14-N100-8-256",
    category: "electronics/laptops",
    category_id: "ELEC-LAPTOP",
    price: 349.0,
    image: "/images/laptops/RC-LT-349.svg",
    description: "Unbranded 14-inch laptop, direct from factory. Intel N-series, 8GB RAM, 256GB SSD, Windows 11 Home.",
  },
  {
    sku: "RC-LT-549",
    name: '15.6" Laptop — 16GB / 512GB SSD',
    brand: "Unbranded",
    model: "RC156-R5-16-512",
    category: "electronics/laptops",
    category_id: "ELEC-LAPTOP",
    price: 549.0,
    image: "/images/laptops/RC-LT-549.svg",
    description: "Unbranded 15.6-inch laptop, direct from factory. Ryzen 5, 16GB RAM, 512GB SSD, Windows 11 Home.",
  },
  {
    sku: "RC-SL-004",
    name: "Neoprene Laptop Sleeve — 15\"",
    brand: "Unbranded",
    model: "RC-SLV-15",
    category: "accessories/bags",
    category_id: "ACC-BAG",
    price: 4.0,
    image: "/images/laptops/RC-SL-004.svg",
    description: "Padded neoprene sleeve with zip. Fits laptops up to 15.6 inches.",
  },
];

function findProduct(sku) {
  return PRODUCTS.find((p) => p.sku === sku) || null;
}

if (typeof module !== "undefined") module.exports = { PRODUCTS, findProduct };
