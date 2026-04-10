const axios  = require('axios');
const config = require('../config');
const db     = require('../db/db');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
//  Debounce: prevent duplicate alerts within COOLDOWN_MINUTES
// ------------------------------------------------------------------

const COOLDOWN_MINUTES = parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10) || 30;

async function isDuplicate(alertType, alertKey) {
  const rows = await db.query(
    `SELECT id FROM alert_log
      WHERE alert_type = ? AND alert_key = ?
        AND sent_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
      LIMIT 1`,
    [alertType, alertKey, COOLDOWN_MINUTES]
  );
  return rows.length > 0;
}

async function logAlert(alertType, alertKey, message, channel) {
  await db.query(
    'INSERT INTO alert_log (alert_type, alert_key, message, channel) VALUES (?, ?, ?, ?)',
    [alertType, alertKey, message, channel]
  );
}

// ------------------------------------------------------------------
//  Telegram
// ------------------------------------------------------------------

async function sendTelegram(message) {
  const token  = config.alerts.telegramBotToken;
  const chatId = config.alerts.telegramChatId;

  if (!token || !chatId) {
    logger.debug('[ALERT] Telegram not configured — skipping');
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: message, parse_mode: 'HTML' },
      { timeout: 10000 }
    );
    return true;
  } catch (err) {
    logger.error(`[ALERT] Telegram send failed: ${err.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
//  Email (nodemailer)
// ------------------------------------------------------------------

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { smtpHost, smtpPort, smtpUser, smtpPass } = config.alerts;
  if (!smtpHost || !smtpUser) return null;

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  return transporter;
}

async function sendEmail(subject, body) {
  const { emailTo, smtpUser } = config.alerts;
  const transport = getTransporter();
  if (!transport || !emailTo) {
    logger.debug('[ALERT] Email not configured — skipping');
    return false;
  }

  try {
    await transport.sendMail({
      from: smtpUser,
      to: emailTo,
      subject: `[EPOS-WOO] ${subject}`,
      text: body,
    });
    return true;
  } catch (err) {
    logger.error(`[ALERT] Email send failed: ${err.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
//  Unified send (debounced)
// ------------------------------------------------------------------

async function send(alertType, alertKey, message, { force = false } = {}) {
  try {
    if (!force) {
      const dup = await isDuplicate(alertType, alertKey);
      if (dup) {
        logger.debug(`[ALERT] Suppressed duplicate: ${alertType}/${alertKey}`);
        return;
      }
    }

    const channels = [];
    if (await sendTelegram(message)) channels.push('telegram');
    if (await sendEmail(alertType, message)) channels.push('email');

    if (channels.length > 0) {
      await logAlert(alertType, alertKey, message, channels.join(','));
      logger.info(`[ALERT] Sent (${channels.join(',')}): ${alertType}/${alertKey}`);
    }
  } catch (err) {
    logger.error(`[ALERT] send error: ${err.message}`);
  }
}

module.exports = { send, sendTelegram, sendEmail };
