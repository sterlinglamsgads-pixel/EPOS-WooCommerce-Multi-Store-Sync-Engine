require('dotenv').config();

const { Worker }     = require('bullmq');
const { connection } = require('../config/redis');
const { QUEUE_NAME } = require('./sync.queue');
const syncEngine     = require('./sync.engine');
const logger         = require('../utils/logger');
const db             = require('../db/db');
const cache          = require('../utils/cache');
const failureDetector = require('../alerts/failure.detector');
const anomalyDetector = require('../alerts/anomaly.detector');
const predictive     = require('../alerts/predictive');
const errorClassifier = require('../utils/error-classifier');

// Rate-limit delay (ms) between product sync jobs
const RATE_LIMIT_MS = parseInt(process.env.SYNC_RATE_LIMIT_MS, 10) || 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const worker = new Worker(QUEUE_NAME, async (job) => {
  logger.info(`[WORKER] Processing ${job.name}#${job.id}`);

  switch (job.name) {
    case 'sync-all-stores':
      return syncEngine.syncAllStores();

    case 'sync-store':
      return syncEngine.syncStore(job.data.storeId, {
        dryRun: job.data.dryRun || false,
      });

    case 'sync-product': {
      const result = await syncEngine.syncProduct(job.data);
      // Rate-limit between product syncs to avoid API throttling
      await sleep(RATE_LIMIT_MS);
      return result;
    }

    case 'webhook-sync':
      return syncEngine.syncProductFromWebhook(job.data);

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}, {
  connection,
  concurrency: 5,
});

worker.on('completed', (job) => {
  logger.info(`[WORKER] ${job.name}#${job.id} completed`);
});

worker.on('failed', (job, err) => {
  const classification = errorClassifier.classify(err);
  logger.error(
    `[WORKER] ${job.name}#${job.id} failed [${classification.type}] ` +
    `(attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`
  );

  // Alert if final attempt
  if (job.attemptsMade >= (job.opts.attempts || 3)) {
    const sku     = job.data.eposProduct?.sku || job.data.sku || 'unknown';
    const storeId = job.data.storeId || '?';

    if (job.name === 'sync-store') {
      failureDetector.storeFailure(storeId, job.data.storeName || storeId, err.message);
    }
  }
});

// Periodic predictive + anomaly check (every 5 minutes)
setInterval(() => {
  anomalyDetector.checkQueueBacklog().catch(() => {});
  predictive.checkQueueGrowth().catch(() => {});
}, 5 * 60 * 1000);

// Run full predictive checks every 30 minutes
setInterval(() => {
  predictive.runAll().catch((err) => {
    logger.error(`[WORKER] Predictive check error: ${err.message}`);
  });
}, 30 * 60 * 1000);

// ------------------------------------------------------------------
//  Graceful shutdown
// ------------------------------------------------------------------

async function shutdown(signal) {
  logger.info(`[WORKER] ${signal} — shutting down`);
  await worker.close();
  await db.close();
  await cache.close();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info('[WORKER] Sync worker started — waiting for jobs');
