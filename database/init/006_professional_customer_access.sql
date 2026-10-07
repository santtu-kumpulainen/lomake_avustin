-- Explicit professional -> customer assignments (Issue #32). The only source of a professional's
-- access to an individual customer's data. Created and removed by ADMIN only.
-- Roles (PROFESSIONAL / USER) cannot be enforced across tables here; the backend validates them
-- on create and re-checks them on every read.
-- On an existing volume, run this file once manually (see README); never via `down -v`.

SET NAMES utf8mb4;

CREATE TABLE professional_customer_access (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  professional_user_id INT UNSIGNED NOT NULL,
  customer_user_id     INT UNSIGNED NOT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One assignment per pair; also serves the professional's lookups and its foreign key.
  UNIQUE KEY uq_professional_customer (professional_user_id, customer_user_id),
  KEY idx_professional_customer_customer (customer_user_id),
  CONSTRAINT chk_professional_customer_distinct CHECK (professional_user_id <> customer_user_id),
  CONSTRAINT fk_professional_customer_professional
    FOREIGN KEY (professional_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_professional_customer_customer
    FOREIGN KEY (customer_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
