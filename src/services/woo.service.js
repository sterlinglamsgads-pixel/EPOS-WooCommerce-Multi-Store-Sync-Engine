const axios  = require('axios');
const logger = require('../utils/logger');
const cache  = require('../utils/cache');

// ------------------------------------------------------------------
//  Client factory — one per-store WooCommerce instance
// ------------------------------------------------------------------

function createClient(store) {
  return axios.create({
    baseURL: store.woo_url,
    auth: {
      username: store.woo_key,
      password: store.woo_secret,
    },
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------------
//  Read helpers
// ------------------------------------------------------------------

async function fetchPage(client, page = 1, perPage = 50) {
  const response   = await client.get('/products', {
    params: { page, per_page: perPage },
  });
  const totalPages = parseInt(response.headers['x-wp-totalpages'], 10) || 1;
  return { products: response.data, totalPages };
}

/**
 * Fetch ALL WooCommerce products (paginated, cached per store).
 */
async function fetchAllProducts(store) {
  const cacheKey = `store:${store.id}:woo:products`;
  const cached   = await cache.get(cacheKey);
  if (cached) {
    logger.debug(`[WOO] Store ${store.id}: using cached products (${cached.length})`);
    return cached;
  }

  const client    = createClient(store);
  const PER_PAGE  = 50;
  let page        = 1;
  let allProducts = [];
  let totalPages  = 1;

  logger.info(`[WOO] Store ${store.id}: starting product fetch…`);

  while (page <= totalPages) {
    const result = await fetchPage(client, page, PER_PAGE);
    totalPages   = result.totalPages;
    allProducts  = allProducts.concat(result.products);
    logger.debug(`[WOO] Store ${store.id}: page ${page}/${totalPages} — ${result.products.length} products`);
    page++;
  }

  logger.info(`[WOO] Store ${store.id}: fetched ${allProducts.length} products in ${page - 1} pages.`);
  await cache.set(cacheKey, allProducts, 300); // 5-minute TTL
  return allProducts;
}

// ------------------------------------------------------------------
//  Write helpers
// ------------------------------------------------------------------

/**
 * Update a single WooCommerce product by ID.
 */
async function updateProduct(store, wooId, data) {
  const client   = createClient(store);
  const response = await client.put(`/products/${encodeURIComponent(wooId)}`, data);
  return response.data;
}

/**
 * Batch-update up to 100 products per request (WooCommerce limit).
 * `updates` is an array of { id, stock_quantity, regular_price, manage_stock }.
 */
async function batchUpdate(store, updates) {
  const client     = createClient(store);
  const CHUNK_SIZE = 100;
  const results    = [];

  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk    = updates.slice(i, i + CHUNK_SIZE);
    const response = await client.post('/products/batch', { update: chunk });
    results.push(...(response.data.update || []));
    logger.debug(`[WOO] Store ${store.id}: batch updated ${chunk.length} products (offset ${i})`);
  }

  return results;
}

/**
 * Create a new product in WooCommerce.
 */
async function createProduct(store, data) {
  const client   = createClient(store);
  const response = await client.post('/products', data);
  return response.data;
}

/**
 * Look up a WooCommerce product by SKU. Returns the first match or null.
 */
async function findBySku(store, sku) {
  try {
    const client   = createClient(store);
    const response = await client.get('/products', {
      params: { sku, per_page: 1 },
    });
    return response.data.length > 0 ? response.data[0] : null;
  } catch (err) {
    logger.error(`[WOO] Store ${store.id} findBySku(${sku}) error: ${err.message}`);
    return null;
  }
}

module.exports = { fetchAllProducts, updateProduct, batchUpdate, createProduct, findBySku };
