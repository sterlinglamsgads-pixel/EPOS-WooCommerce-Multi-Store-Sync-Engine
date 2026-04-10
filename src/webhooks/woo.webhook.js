const crypto    = require('crypto');
const config    = require('../config');
const syncQueue = require('../sync/sync.queue');
const logger    = require('../utils/logger');

function verifySignature(payload, signature) {
  if (!config.wooWebhookSecret) return true; // skip if not configured
  const expected = crypto
    .createHmac('sha256', config.wooWebhookSecret)
    .update(payload, 'utf8')
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleProductUpdated(req, res) {
  const storeId = parseInt(req.params.storeId, 10);
  if (!storeId) return res.status(400).json({ error: 'Invalid store ID' });

  // Signature verification
  if (config.wooWebhookSecret) {
    const signature = req.headers['x-wc-webhook-signature'];
    if (!signature || !verifySignature(req.rawBody || JSON.stringify(req.body), signature)) {
      logger.warn(`[WEBHOOK] WOO store ${storeId}: invalid or missing signature`);
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const product = req.body;
  if (!product || !product.id) {
    return res.status(400).json({ error: 'Missing product data' });
  }

  logger.info(`[WEBHOOK] WOO store ${storeId}: product ${product.id} updated`);

  await syncQueue.addWebhookSyncJob({
    storeId,
    source: 'woo',
    productId: product.id,
  });

  res.json({ received: true });
}

module.exports = { handleProductUpdated };
