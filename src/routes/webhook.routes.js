const { Router }  = require('express');
const crypto      = require('crypto');
const config      = require('../config');
const syncQueue   = require('../sync/sync.queue');
const logger      = require('../utils/logger');
const wooWebhook  = require('../webhooks/woo.webhook');
const eposWebhook = require('../webhooks/epos.webhook');

const router = Router();

// ── Source-specific endpoints (backward compatible) ──
router.post('/woo/:storeId/product-updated',  wooWebhook.handleProductUpdated);
router.post('/epos/:storeId/product-updated', eposWebhook.handleProductUpdated);

// ── Unified single webhook endpoint ──
// POST /webhooks/product  { storeId, source: "epos"|"woo", product: {...} }
router.post('/product', async (req, res) => {
  const { storeId, source, product } = req.body || {};

  if (!storeId || !source) {
    return res.status(400).json({ error: 'Missing storeId or source' });
  }

  // Validate signature (check both header variants)
  const secret = source === 'woo' ? config.wooWebhookSecret : config.webhookSecret;
  if (secret) {
    const signature = req.headers['x-webhook-signature']
      || req.headers['x-wc-webhook-signature']
      || req.headers['x-epos-signature'];
    const payload = req.rawBody || JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest(source === 'woo' ? 'base64' : 'hex');
    try {
      if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        logger.warn(`[WEBHOOK] Unified endpoint: invalid signature for store ${storeId}`);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  if (!product) {
    return res.status(400).json({ error: 'Missing product data' });
  }

  const productId = source === 'woo' ? product.id : product.Id;
  logger.info(`[WEBHOOK] Unified: ${source} store ${storeId}, product ${productId}`);

  await syncQueue.addWebhookSyncJob({
    storeId: parseInt(storeId, 10),
    source,
    productId,
    productData: source === 'epos' ? product : undefined,
  });

  res.json({ received: true });
});

module.exports = router;
