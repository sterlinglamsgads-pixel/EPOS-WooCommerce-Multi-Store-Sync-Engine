const config = require('./index');

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

if (config.redis.password) {
  connection.password = config.redis.password;
}

module.exports = { connection };
