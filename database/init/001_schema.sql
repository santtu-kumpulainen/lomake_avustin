-- Lomakeavustin MVP schema.
-- Runs automatically on the first MariaDB start with an empty volume.
-- The entrypoint selects MARIADB_DATABASE, so no database name is hardcoded here.
-- Synthetic data only.

SET NAMES utf8mb4;

CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('USER', 'ADMIN', 'PROFESSIONAL') NOT NULL DEFAULT 'USER',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-to-one with users: user_id is both the primary key and the foreign key.
CREATE TABLE user_profiles (
  user_id    INT UNSIGNED NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  phone      VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_profiles_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE form_templates (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status      ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Regular users only see PUBLISHED templates.
  KEY idx_form_templates_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE form_fields (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  form_template_id INT UNSIGNED NOT NULL,
  label            VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  field_type       ENUM('TEXT', 'NUMBER', 'DATE', 'SELECT') NOT NULL,
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  position         SMALLINT UNSIGNED NOT NULL,
  -- SELECT choices as a JSON array of strings, e.g. ["Kyllä", "Ei"]. NULL for other types.
  options          JSON NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Not unique so fields can be reordered without temporary conflicts.
  -- Also serves as the index for the template foreign key.
  KEY idx_form_fields_template_position (form_template_id, position),
  CONSTRAINT chk_form_fields_options CHECK (
    (field_type = 'SELECT' AND options IS NOT NULL AND JSON_TYPE(options) = 'ARRAY')
    OR (field_type <> 'SELECT' AND options IS NULL)
  ),
  CONSTRAINT fk_form_fields_template
    FOREIGN KEY (form_template_id) REFERENCES form_templates (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE form_submissions (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          INT UNSIGNED NOT NULL,
  form_template_id INT UNSIGNED NOT NULL,
  status           ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',
  -- User-facing identifier such as LA-7F42K9. Not the primary key.
  reference_code   VARCHAR(16) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  submitted_at     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_form_submissions_reference_code (reference_code),
  -- Covers "my drafts / my submissions" lookups and the user foreign key.
  KEY idx_form_submissions_user_status (user_id, status),
  -- Professional view lists submitted forms.
  KEY idx_form_submissions_status (status),
  CONSTRAINT chk_form_submissions_submitted_at CHECK (
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL)
    OR (status = 'DRAFT' AND submitted_at IS NULL)
  ),
  CONSTRAINT fk_form_submissions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- Templates with submissions are archived, not deleted.
  CONSTRAINT fk_form_submissions_template
    FOREIGN KEY (form_template_id) REFERENCES form_templates (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Values are stored as text and validated by the backend against form_fields.field_type
-- (NUMBER as a decimal string, DATE as YYYY-MM-DD, SELECT as one of the options).
CREATE TABLE form_answers (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id INT UNSIGNED NOT NULL,
  field_id      INT UNSIGNED NOT NULL,
  answer_value  TEXT NULL,
  is_prefilled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One answer per field per submission; also indexes the submission foreign key.
  UNIQUE KEY uq_form_answers_submission_field (submission_id, field_id),
  KEY idx_form_answers_field (field_id),
  CONSTRAINT fk_form_answers_submission
    FOREIGN KEY (submission_id) REFERENCES form_submissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_form_answers_field
    FOREIGN KEY (field_id) REFERENCES form_fields (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Synthetic contact history for the professional "one customer view".
CREATE TABLE customer_contacts (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  contact_type ENUM('PHONE', 'EMAIL', 'VISIT', 'MESSAGE') NOT NULL,
  summary      VARCHAR(500) NOT NULL,
  contacted_at DATETIME NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Customer history ordered by time; also indexes the user foreign key.
  KEY idx_customer_contacts_user_contacted (user_id, contacted_at),
  CONSTRAINT fk_customer_contacts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
