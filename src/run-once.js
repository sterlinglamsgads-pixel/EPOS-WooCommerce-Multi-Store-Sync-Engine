/**
 * Run a single sync cycle for one or all stores, then exit.
 *
 * Usage:
 *   node src/run-once.js              → sync all active stores (live)
 *   node src/run-once.js 2            → sync store id 2 only
 *   DRY_RUN=true node src/run-once.js → dry-run all stores
 */
require('dotenv').config();

const syncEngine = require('./sync/sync.engine');
const db         = require('./db/db');
const cache      = require('./utils/cache');
const logger     = require('./utils/logger');

const dryRun = process.env.DRY_RUN === 'true';
const storeId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

(async () => {
  try {
    if (storeId) {
      const stats = await syncEngine.syncStore(storeId, { dryRun });
      logger.info(`[RUN-ONCE] Store ${storeId} complete — ${JSON.stringify(stats)}`);
    } else {
      const stores = await syncEngine.getActiveStores();
      for (const store of stores) {
        const stats = await syncEngine.syncStore(store.id, { dryRun });
        logger.info(`[RUN-ONCE] Store "${store.name}" — ${JSON.stringify(stats)}`);
      }
    }
  } catch (err) {
    logger.error(`[RUN-ONCE] Failed: ${err.message}`);
  } finally {
    await db.close();
    await cache.close();
    process.exit(0);
  }
})();
