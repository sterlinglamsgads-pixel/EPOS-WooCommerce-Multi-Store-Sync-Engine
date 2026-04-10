require('dotenv').config();

const path           = require('path');
const express        = require('express');
const config         = require('./config');
const logger         = require('./utils/logger');
const db             = require('./db/db');
const cache          = require('./utils/cache');
const apiRoutes      = require('./routes/api.routes');
const dashRoutes     = require('./routes/dashboard.routes');
const webhookRoutes  = require('./routes/webhook.routes');
const syncJob        = require('./cron/sync.job');

const app = express();

// Preserve raw body for webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));

// CORS for dev (dashboard on :5173)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ------------------------------------------------------------------
//  Routes
// ------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api', apiRoutes);
app.use('/api/dashboard', dashRoutes);
app.use('/webhooks', webhookRoutes);

// Serve dashboard static files in production
const dashDist = path.join(__dirname, '..', 'dashboard', 'dist');
app.use('/dashboard', express.static(dashDist));
app.get('/dashboard/*', (_req, res) => {
  res.sendFile(path.join(dashDist, 'index.html'));
});

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
