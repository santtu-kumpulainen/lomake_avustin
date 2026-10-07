-- Customer's own description of why they are seeking help (Issue #26).
-- Separate from form submissions: it is not an answer to any form.
-- On an existing volume, run this file once manually (see README); never via `down -v`.

SET NAMES utf8mb4;

CREATE TABLE symptom_descriptions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  -- Free text written by the user, max 2000 characters (enforced by the backend).
  description TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The user's history newest first; also indexes the user foreign key.
  KEY idx_symptom_descriptions_user_created (user_id, created_at),
  CONSTRAINT fk_symptom_descriptions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
