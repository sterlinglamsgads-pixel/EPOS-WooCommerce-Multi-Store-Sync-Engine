const fs     = require('fs');
const path   = require('path');
const config = require('../config');

const LOG_DIR = config.log.dir;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function formatMessage(level, msg) {
  return `[${timestamp()}] [${level.toUpperCase()}] ${msg}`;
}

function writeToFile(level, msg) {
  const date     = new Date().toISOString().slice(0, 10);
  const filePath = path.join(LOG_DIR, `sync-${date}.log`);
  const line     = formatMessage(level, msg) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

const logger = {
  info(msg) {
    console.log(formatMessage('info', msg));
    writeToFile('info', msg);
  },

  warn(msg) {
    console.warn(formatMessage('warn', msg));
    writeToFile('warn', msg);
  },

  error(msg) {
    console.error(formatMessage('error', msg));
    writeToFile('error', msg);
  },

  debug(msg) {
    if (config.log.level === 'debug') {
      console.log(formatMessage('debug', msg));
      writeToFile('debug', msg);
    }
  },
};

module.exports = logger;
