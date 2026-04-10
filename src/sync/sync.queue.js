const { Queue } = require('bullmq');
const { connection } = require('../config/redis');

const QUEUE_NAME = 'sync-queue';

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail:     { count: 5000 },
};

const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions });

// ------------------------------------------------------------------
//  Job producers
// ------------------------------------------------------------------

async function addSyncAllStoresJob() {
  return queue.add('sync-all-stores', {}, defaultJobOptions);
}

async function addSyncStoreJob(storeId, opts = {}) {
  return queue.add('sync-store', { storeId }, {
    ...defaultJobOptions,
    ...opts,
  });
}

async function addSyncProductJob(data, opts = {}) {
  return queue.add('sync-product', data, {
    ...defaultJobOptions,
    ...opts,
  });
}

async function addWebhookSyncJob(data) {
  return queue.add('webhook-sync', data, {
    ...defaultJobOptions,
    priority: 1, // higher priority for real-time updates
  });
}

module.exports = {
  queue,
  QUEUE_NAME,
  addSyncAllStoresJob,
  addSyncStoreJob,
  addSyncProductJob,
  addWebhookSyncJob,
};
