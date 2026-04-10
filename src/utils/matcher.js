const skuUtil = require('./sku.util');

/**
 * Match EPOS products to WooCommerce products using priority:
 *   1. SKU (normalized)
 *   2. Barcode (checked against WooCommerce SKU field)
 *   3. Name   (exact, case-insensitive)
 *
 * Returns { matched: [{ epos, woo, method }], unmatched: [eposProduct] }
 */
function matchProducts(eposProducts, wooProducts) {
  // Build WooCommerce indexes
  const wooByNormSku = new Map();
  const wooByName    = new Map();

  for (const wp of wooProducts) {
    if (wp.sku) {
      const norm = skuUtil.normalize(wp.sku);
      if (norm) wooByNormSku.set(norm, wp);
    }
    const name = (wp.name || '').toLowerCase().trim();
    if (name) wooByName.set(name, wp);
  }

  const matched    = [];
  const unmatched  = [];
  const usedWooIds = new Set();

  for (const ep of eposProducts) {
    let wooMatch = null;
    let method   = null;

    // Priority 1 — SKU
    if (ep.sku) {
      const norm      = skuUtil.normalize(ep.sku);
      const candidate = wooByNormSku.get(norm);
      if (candidate && !usedWooIds.has(candidate.id)) {
        wooMatch = candidate;
        method   = 'sku';
      }
    }

    // Priority 2 — Barcode (may be stored as WooCommerce SKU)
    if (!wooMatch && ep.barcode) {
      const norm      = skuUtil.normalize(ep.barcode);
      const candidate = wooByNormSku.get(norm);
      if (candidate && !usedWooIds.has(candidate.id)) {
        wooMatch = candidate;
        method   = 'barcode';
      }
    }

    // Priority 3 — Name (exact case-insensitive)
    if (!wooMatch && ep.name) {
      const name      = ep.name.toLowerCase().trim();
      const candidate = wooByName.get(name);
      if (candidate && !usedWooIds.has(candidate.id)) {
        wooMatch = candidate;
        method   = 'name';
      }
    }

    if (wooMatch) {
      usedWooIds.add(wooMatch.id);
      matched.push({ epos: ep, woo: wooMatch, method });
    } else {
      unmatched.push(ep);
    }
  }

  return { matched, unmatched };
}

module.exports = { matchProducts };
