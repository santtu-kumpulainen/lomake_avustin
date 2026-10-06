-- Server-side login sessions (Issue #4).
-- The browser holds a random token in an HTTP-only cookie; only its SHA-256 hash is stored,
-- so a database leak does not expose usable session tokens.
-- Logout deletes the row, which invalidates the token immediately.

SET NAMES utf8mb4;

CREATE TABLE sessions (
  token_hash CHAR(64) NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
