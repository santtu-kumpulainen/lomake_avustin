-- Assignment metadata (Issue #38): who created an assignment, why, and until when it grants access.
-- created_at already exists (006). Keys, the self-assignment CHECK and cascades are unchanged.
-- On an existing volume, run this file once manually (see README); never via `down -v`.
--
-- Existing assignments: kept and stay active (expires_at NULL). Their creator was never stored,
-- so created_by_user_id stays NULL ("not recorded") instead of naming an arbitrary admin.

SET NAMES utf8mb4;

ALTER TABLE professional_customer_access
  -- The admin from the session. NULL: created before this migration, or the admin account was
  -- deleted later (the assignment itself must not disappear with its creator).
  ADD COLUMN created_by_user_id INT UNSIGNED NULL AFTER customer_user_id,
  -- Free text, trimmed and limited to 300 characters by the backend.
  ADD COLUMN purpose VARCHAR(300) NULL AFTER created_by_user_id,
  -- Database time like sessions.expires_at, compared with NOW(). NULL = no expiry.
  ADD COLUMN expires_at DATETIME NULL AFTER purpose,
  ADD KEY idx_professional_customer_created_by (created_by_user_id),
  ADD CONSTRAINT fk_professional_customer_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL;
