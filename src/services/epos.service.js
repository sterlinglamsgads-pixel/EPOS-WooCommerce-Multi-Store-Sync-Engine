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

async function fetchPage(client, page = 1, pageSize = 200) {
  const response = await client.get('/Product', {
    params: { page, pageSize },
  });
  return response.data;
}

/**
 * Fetch ALL products from EPOS Now (paginated, cached per store).
 */
async function fetchAllProducts(store) {
  const cacheKey = `store:${store.id}:epos:products`;
  const cached   = await cache.get(cacheKey);
  if (cached) {
    logger.debug(`[EPOS] Store ${store.id}: using cached products (${cached.length})`);
    return cached;
  }

  const client    = createClient(store);
  const PAGE_SIZE = 200;
  let page        = 1;
  let allProducts = [];
  let hasMore     = true;

  logger.info(`[EPOS] Store ${store.id}: starting product fetch…`);

  while (hasMore) {
    const products = await fetchPage(client, page, PAGE_SIZE);
    if (!Array.isArray(products) || products.length === 0) break;

    allProducts = allProducts.concat(products);
    logger.debug(`[EPOS] Store ${store.id}: page ${page} — ${products.length} products (total: ${allProducts.length})`);
    page++;

    if (products.length < PAGE_SIZE) hasMore = false;
  }

  logger.info(`[EPOS] Store ${store.id}: fetched ${allProducts.length} products in ${page - 1} pages.`);
  await cache.set(cacheKey, allProducts, 300); // 5-minute TTL
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
