require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'epos_woo_sync',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  sync: {
    direction: process.env.SYNC_DIRECTION || 'EPOS_TO_WOO',
    intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 10,
    batchSize: parseInt(process.env.BATCH_SIZE, 10) || 20,
    dryRun: process.env.DRY_RUN === 'true',
  },

  epos: {
    apiUrl: process.env.EPOS_API_URL || 'https://api.eposnowhq.com/api/v4',
    apiToken: process.env.EPOS_API_TOKEN || '',
  },

  log: {
    dir: process.env.LOG_DIR || './logs',
    level: process.env.LOG_LEVEL || 'info',
  },

  apiKey: process.env.API_KEY || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  wooWebhookSecret: process.env.WOO_WEBHOOK_SECRET || '',

  dashboard: {
    user: process.env.DASHBOARD_USER || '',
    pass: process.env.DASHBOARD_PASS || '',
  },
};
