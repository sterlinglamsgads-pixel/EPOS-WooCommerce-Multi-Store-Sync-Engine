/**
 * SKU Normalization Layer
 *
 * Strips dashes, spaces, underscores, dots, slashes and lowercases the string
 * so that "303-2281", "303 2281", and "3032281" all resolve to the same key.
 */

function normalize(sku) {
  if (typeof sku !== 'string') return '';
  return sku.replace(/[\s\-_./\\]+/g, '').toLowerCase().trim();
}

/**
 * Returns true when two raw SKUs refer to the same product after normalization.
 */
function match(skuA, skuB) {
  return normalize(skuA) === normalize(skuB) && normalize(skuA) !== '';
}

module.exports = { normalize, match };
