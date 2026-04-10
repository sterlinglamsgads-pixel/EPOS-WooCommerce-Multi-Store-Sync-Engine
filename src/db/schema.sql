CREATE DATABASE IF NOT EXISTS epos_woo_sync
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE epos_woo_sync;

-- ---------------------------------------------------------
--  Store configuration (one row per physical / WooCommerce store)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  epos_branch_id  VARCHAR(255) NOT NULL,
  epos_api_url    VARCHAR(512) DEFAULT NULL,
  epos_api_token  VARCHAR(512) DEFAULT NULL,
  woo_url         VARCHAR(512) NOT NULL,
  woo_key         VARCHAR(512) NOT NULL,
  woo_secret      VARCHAR(512) NOT NULL,
  sync_direction  ENUM('EPOS_TO_WOO','WOO_TO_EPOS','BIDIRECTIONAL') NOT NULL DEFAULT 'EPOS_TO_WOO',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at  DATETIME DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_branch (epos_branch_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Maps EPOS products ↔ WooCommerce products per store
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_mappings (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id        INT UNSIGNED NOT NULL,
  epos_product_id VARCHAR(255) NOT NULL,
  woo_product_id  BIGINT UNSIGNED DEFAULT NULL,
  sku             VARCHAR(255) DEFAULT NULL,
  barcode         VARCHAR(255) DEFAULT NULL,
  normalized_sku  VARCHAR(255) DEFAULT NULL,
  match_method    ENUM('sku','barcode','name','manual') DEFAULT NULL,
  last_synced_at  DATETIME DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_store_epos    (store_id, epos_product_id),
  INDEX      idx_store_sku    (store_id, normalized_sku),
  INDEX      idx_store_barcode(store_id, barcode),
  INDEX      idx_store_woo    (store_id, woo_product_id),

  CONSTRAINT fk_mapping_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Append-only log of every per-product sync attempt
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id   INT UNSIGNED NOT NULL,
  sku        VARCHAR(255) DEFAULT NULL,
  action     VARCHAR(50)  NOT NULL,
  status     ENUM('success','failed','skipped') NOT NULL,
  message    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_store   (store_id),
  INDEX idx_status  (status),
  INDEX idx_created (created_at),

  CONSTRAINT fk_log_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Run-level summary (one row per store sync invocation)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id       INT UNSIGNED DEFAULT NULL,
  started_at     DATETIME NOT NULL,
  finished_at    DATETIME DEFAULT NULL,
  total_products INT UNSIGNED DEFAULT 0,
  synced         INT UNSIGNED DEFAULT 0,
  created        INT UNSIGNED DEFAULT 0,
  failed         INT UNSIGNED DEFAULT 0,
  skipped        INT UNSIGNED DEFAULT 0,
  dry_run        TINYINT(1) DEFAULT 0,
  status         ENUM('running','completed','failed') NOT NULL DEFAULT 'running',

  INDEX idx_store  (store_id),
  INDEX idx_status (status),

  CONSTRAINT fk_run_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Failure tracking (recurring failures per SKU)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS failure_logs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id      INT UNSIGNED NOT NULL,
  sku           VARCHAR(255) DEFAULT NULL,
  error         TEXT,
  fail_count    INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_occurred DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved      TINYINT(1) NOT NULL DEFAULT 0,

  UNIQUE KEY uq_store_sku (store_id, sku),
  INDEX idx_store (store_id),
  INDEX idx_resolved (resolved),

  CONSTRAINT fk_failure_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Sync metrics (aggregated per store per run)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_metrics (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id      INT UNSIGNED NOT NULL,
  total_synced  INT UNSIGNED NOT NULL DEFAULT 0,
  total_failed  INT UNSIGNED NOT NULL DEFAULT 0,
  total_created INT UNSIGNED NOT NULL DEFAULT 0,
  total_skipped INT UNSIGNED NOT NULL DEFAULT 0,
  avg_duration  FLOAT DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_store   (store_id),
  INDEX idx_created (created_at),

  CONSTRAINT fk_metric_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Alert log (prevents duplicate spam)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_log (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  alert_type VARCHAR(100) NOT NULL,
  alert_key  VARCHAR(255) NOT NULL,
  message    TEXT,
  channel    VARCHAR(50) DEFAULT 'telegram',
  sent_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_type_key  (alert_type, alert_key),
  INDEX idx_sent      (sent_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Users (JWT auth + role-based access)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','manager','viewer') NOT NULL DEFAULT 'viewer',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login    DATETIME DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_email    (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Audit log (tracks every user action)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED DEFAULT NULL,
  username   VARCHAR(100) DEFAULT NULL,
  action     VARCHAR(100) NOT NULL,
  resource   VARCHAR(100) DEFAULT NULL,
  resource_id VARCHAR(255) DEFAULT NULL,
  details    JSON DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user     (user_id),
  INDEX idx_action   (action),
  INDEX idx_resource (resource, resource_id),
  INDEX idx_created  (created_at),

  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Self-healing action log
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS healing_logs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id      INT UNSIGNED NOT NULL,
  sku           VARCHAR(255) DEFAULT NULL,
  action_type   VARCHAR(100) NOT NULL,
  description   TEXT,
  success       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_store   (store_id),
  INDEX idx_action  (action_type),
  INDEX idx_created (created_at),

  CONSTRAINT fk_healing_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
--  Predictive metrics (trend tracking)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS predictive_metrics (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  metric_type    VARCHAR(100) NOT NULL,
  store_id       INT UNSIGNED DEFAULT NULL,
  value          FLOAT NOT NULL,
  recorded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_type_store (metric_type, store_id),
  INDEX idx_recorded   (recorded_at),

  CONSTRAINT fk_predictive_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;
