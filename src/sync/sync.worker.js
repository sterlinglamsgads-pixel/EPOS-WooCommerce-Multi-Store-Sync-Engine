require('dotenv').config();

const { Worker }     = require('bullmq');
const { connection } = require('../config/redis');
const { QUEUE_NAME } = require('./sync.queue');
const syncEngine     = require('./sync.engine');
const logger         = require('../utils/logger');
const db             = require('../db/db');
const cache          = require('../utils/cache');

const worker = new Worker(QUEUE_NAME, async (job) => {
  logger.info(`[WORKER] Processing ${job.name}#${job.id}`);

  switch (job.name) {
    case 'sync-all-stores':
      return syncEngine.syncAllStores();

    case 'sync-store':
      return syncEngine.syncStore(job.data.storeId, {
        dryRun: job.data.dryRun || false,
      });

    case 'sync-product':
      return syncEngine.syncProduct(job.data);

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
  logger.error(
    `[WORKER] ${job.name}#${job.id} failed ` +
    `(attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`
  );
});

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
