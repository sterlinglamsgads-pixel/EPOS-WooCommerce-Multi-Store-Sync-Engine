const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const cache  = require('../utils/cache');

// ------------------------------------------------------------------
//  Client factory — builds an axios instance for a given store
// ------------------------------------------------------------------

function createClient(store) {
  const baseURL = store.epos_api_url || config.epos.apiUrl;
  const token   = store.epos_api_token || config.epos.apiToken;

  return axios.create({
    baseURL,
    headers: {
      Authorization:  `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

// ------------------------------------------------------------------
//  Read helpers
// ------------------------------------------------------------------

/**
 * Fetch ALL products from EPOS Now (paginated, cached per store).
 * Supports delta sync via opts.updatedSince (ISO date string or Date).
 */
async function fetchAllProducts(store, opts = {}) {
  const { updatedSince } = opts;

  // Skip cache when doing delta fetch
  if (!updatedSince) {
    const cacheKey = `store:${store.id}:epos:products`;
    const cached   = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`[EPOS] Store ${store.id}: using cached products (${cached.length})`);
      return cached;
    }
  }

  const client    = createClient(store);
  const PAGE_SIZE = 200;
  let page        = 1;
  let allProducts = [];
  let hasMore     = true;

  const mode = updatedSince ? `delta since ${updatedSince}` : 'full';
  logger.info(`[EPOS] Store ${store.id}: starting product fetch (${mode})…`);

  while (hasMore) {
    const params = { page, pageSize: PAGE_SIZE };
    if (updatedSince) {
      // EPOS Now API accepts updated_since as ISO datetime filter
      params.updated_since = new Date(updatedSince).toISOString();
    }

    const response = await client.get('/Product', { params });
    const products = response.data;

    if (!Array.isArray(products) || products.length === 0) break;

    allProducts = allProducts.concat(products);
    logger.debug(`[EPOS] Store ${store.id}: page ${page} — ${products.length} products (total: ${allProducts.length})`);
    page++;

    if (products.length < PAGE_SIZE) hasMore = false;
  }

  logger.info(`[EPOS] Store ${store.id}: fetched ${allProducts.length} products in ${page - 1} pages.`);

  // Only cache full fetches
  if (!updatedSince) {
    await cache.set(`store:${store.id}:epos:products`, allProducts, 300);
  }

  return allProducts;
}

// ------------------------------------------------------------------
//  Normalization
// ------------------------------------------------------------------

/**
 * Transform a raw EPOS API product into our internal shape.
 */
function normalizeProduct(raw) {
  return {
    eposId:  String(raw.Id),
    name:    raw.Name || '',
    sku:     raw.Sku  || '',
    barcode: raw.Barcode || '',
    price:   parseFloat(raw.SalePrice) || 0,
    stock:   parseInt(raw.CurrentStock, 10) || 0,
  };
}

module.exports = { fetchAllProducts, normalizeProduct };
