const crypto    = require('crypto');
const config    = require('../config');
const syncQueue = require('../sync/sync.queue');
const logger    = require('../utils/logger');

function verifySignature(payload, signature) {
  if (!config.webhookSecret) return true; // skip if not configured
  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(payload, 'utf8')
    .digest('hex');
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
  if (config.webhookSecret) {
    const signature = req.headers['x-epos-signature'];
    if (!signature || !verifySignature(JSON.stringify(req.body), signature)) {
      logger.warn(`[WEBHOOK] EPOS store ${storeId}: invalid or missing signature`);
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const product = req.body;
  if (!product || !product.Id) {
    return res.status(400).json({ error: 'Missing product data' });
  }

  logger.info(`[WEBHOOK] EPOS store ${storeId}: product ${product.Id} updated`);

  await syncQueue.addWebhookSyncJob({
    storeId,
    source: 'epos',
    productId: product.Id,
  });

  res.json({ received: true });
}

module.exports = { handleProductUpdated };
