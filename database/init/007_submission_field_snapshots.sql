-- Questions of a submitted form as they were at submission time (Issue #36).
-- The submitted-form views read questions from here, so later template edits do not change
-- historical submissions. Written in the same transaction that submits the form; drafts have none.
-- On an existing volume, run this file once manually (see README); never via `down -v`.

SET NAMES utf8mb4;

CREATE TABLE submission_field_snapshots (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id   INT UNSIGNED NOT NULL,
  -- form_fields.id at submission time; matches form_answers.field_id. No foreign key on
  -- purpose: the snapshot must stay readable whatever happens to the current field.
  source_field_id INT UNSIGNED NOT NULL,
  label           VARCHAR(255) NOT NULL,
  field_type      ENUM('TEXT', 'NUMBER', 'DATE', 'SELECT') NOT NULL,
  is_required     BOOLEAN NOT NULL,
  -- SELECT choices as offered at submission time. NULL for other types.
  options         JSON NULL,
  -- 1..n in the order the form had at submission time.
  position        SMALLINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One snapshot per field; also indexes the submission foreign key.
  UNIQUE KEY uq_submission_field_snapshots_field (submission_id, source_field_id),
  UNIQUE KEY uq_submission_field_snapshots_position (submission_id, position),
  CONSTRAINT chk_submission_field_snapshots_options CHECK (
    (field_type = 'SELECT' AND options IS NOT NULL AND JSON_TYPE(options) = 'ARRAY')
    OR (field_type <> 'SELECT' AND options IS NULL)
  ),
  CONSTRAINT fk_submission_field_snapshots_submission
    FOREIGN KEY (submission_id) REFERENCES form_submissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Best-effort backfill for forms submitted before snapshots existed, from the current fields.
-- The exact historical questions cannot be reconstructed: a form edited since then gets its
-- current texts. Uses the earlier display rule (answered fields, plus unanswered fields that
-- existed when the form was submitted). Safe to run again: submissions that already have
-- snapshots are skipped.
INSERT INTO submission_field_snapshots
  (submission_id, source_field_id, label, field_type, is_required, options, position)
SELECT s.id, f.id, f.label, f.field_type, f.is_required, f.options,
       ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY f.position, f.id)
  FROM form_submissions s
  JOIN form_fields f ON f.form_template_id = s.form_template_id
  LEFT JOIN form_answers a ON a.submission_id = s.id AND a.field_id = f.id
 WHERE s.status = 'SUBMITTED'
   AND (a.id IS NOT NULL OR f.created_at <= s.submitted_at)
   AND NOT EXISTS (SELECT 1 FROM submission_field_snapshots x WHERE x.submission_id = s.id);
