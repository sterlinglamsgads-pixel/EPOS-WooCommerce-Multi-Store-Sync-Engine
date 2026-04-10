const cron      = require('node-cron');
const config    = require('../config');
const syncQueue = require('../sync/sync.queue');
const logger    = require('../utils/logger');

let isQueuing = false;

function start() {
  const interval   = config.sync.intervalMinutes;
  const expression = `*/${interval} * * * *`;

  logger.info(`[CRON] Scheduling sync every ${interval} minute(s)`);

  cron.schedule(expression, async () => {
    if (isQueuing) {
      logger.warn('[CRON] Previous queue dispatch still running — skipping');
      return;
    }

    isQueuing = true;
    try {
      await syncQueue.addSyncAllStoresJob();
      logger.info('[CRON] sync-all-stores job queued');
    } catch (err) {
      logger.error(`[CRON] Failed to queue sync: ${err.message}`);
    } finally {
      isQueuing = false;
    }
  });
}

module.exports = { start };
