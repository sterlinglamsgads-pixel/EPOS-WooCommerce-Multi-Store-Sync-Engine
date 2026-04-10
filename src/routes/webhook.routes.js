const { Router } = require('express');
const wooWebhook  = require('../webhooks/woo.webhook');
const eposWebhook = require('../webhooks/epos.webhook');

const router = Router();

router.post('/woo/:storeId/product-updated',  wooWebhook.handleProductUpdated);
router.post('/epos/:storeId/product-updated', eposWebhook.handleProductUpdated);

module.exports = router;
