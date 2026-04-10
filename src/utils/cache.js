const Redis  = require('ioredis');
const { connection } = require('../config/redis');
const logger = require('./logger');

let client = null;

function getClient() {
  if (!client) {
    client = new Redis(connection);
    client.on('error', (err) => {
      logger.error(`[CACHE] Redis error: ${err.message}`);
    });
  }
  return client;
}

async function get(key) {
  try {
    const val = await getClient().get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function set(key, value, ttlSeconds = 300) {
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Cache failure is non-fatal
  }
}

async function del(key) {
  try {
    await getClient().del(key);
  } catch {
    // non-fatal
  }
}

async function invalidateStore(storeId) {
  try {
    const stream = getClient().scanStream({ match: `store:${storeId}:*`, count: 100 });
    const keys = [];
    for await (const batch of stream) {
      keys.push(...batch);
    }
    if (keys.length > 0) {
      await getClient().del(...keys);
    }
  } catch {
    // non-fatal
  }
}

async function close() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { get, set, del, invalidateStore, close };
