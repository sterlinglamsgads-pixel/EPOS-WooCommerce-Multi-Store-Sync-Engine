const cron     = require('node-cron');
const logger   = require('../utils/logger');
const alerts   = require('./alert.service');
const analytics = require('./analytics');
const anomaly  = require('./anomaly.detector');

// ------------------------------------------------------------------
//  Daily report — runs at 8 AM (configurable)
// ------------------------------------------------------------------

function start() {
  const expression = process.env.DAILY_REPORT_CRON || '0 8 * * *';
  logger.info(`[REPORT] Daily report cron scheduled: ${expression}`);

  cron.schedule(expression, async () => {
    logger.info('[REPORT] Generating daily report…');
    try {
      await sendDailyReport();
      await anomaly.runChecks();
    } catch (err) {
      logger.error(`[REPORT] Daily report failed: ${err.message}`);
    }
  });
}

async function sendDailyReport() {
  const stats = await analytics.getDailyStats(1);

  const message = [
    '📊 <b>Daily Sync Report</b>',
    '',
    `Stores active: <b>${stats.total_stores}</b>`,
    `Products synced: <b>${stats.total_synced}</b>`,
    `Products created: <b>${stats.total_created}</b>`,
    `Failed: <b>${stats.total_failed}</b>`,
    `Success rate: <b>${stats.success_rate}%</b>`,
    `Avg duration: <b>${stats.avg_duration}s</b>`,
    '',
    `Generated: ${new Date().toLocaleString()}`,
  ].join('\n');

  await alerts.send('daily_report', dateKey(), message, { force: true });
  logger.info('[REPORT] Daily report sent');
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { start, sendDailyReport };
