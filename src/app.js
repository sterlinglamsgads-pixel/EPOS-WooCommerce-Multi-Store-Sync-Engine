require('dotenv').config();

const express        = require('express');
const config         = require('./config');
const logger         = require('./utils/logger');
const db             = require('./db/db');
const cache          = require('./utils/cache');
const apiRoutes      = require('./routes/api.routes');
const webhookRoutes  = require('./routes/webhook.routes');
const syncJob        = require('./cron/sync.job');

const app = express();

// Preserve raw body for webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));

// ------------------------------------------------------------------
//  Routes
// ------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api', apiRoutes);
app.use('/webhooks', webhookRoutes);

// ------------------------------------------------------------------
//  Bootstrap
// ------------------------------------------------------------------

app.listen(config.port, () => {
  logger.info(`[APP] Server listening on port ${config.port}`);
  syncJob.start();
  logger.info('[APP] System ready');
});

// ------------------------------------------------------------------
//  Graceful shutdown
// ------------------------------------------------------------------

async function shutdown(signal) {
  logger.info(`[APP] ${signal} — shutting down`);
  await db.close();
  await cache.close();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error(`[APP] Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`[APP] Uncaught exception: ${err.message}`);
  process.exit(1);
});
