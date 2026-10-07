-- Form template category and demo-form seed key (Issue #24).
-- Additive and nullable, so existing templates stay valid with no category.
-- On an existing volume, run this file once manually (see README); never via `down -v`.

SET NAMES utf8mb4;

ALTER TABLE form_templates
  -- Free-text topic shown on the form list, e.g. "Kipu". No category table for the MVP.
  ADD COLUMN category VARCHAR(100) NULL AFTER description,
  -- Set only on templates created by the demo-form seed. The unique key lets the seed
  -- skip forms it has already created, even after an admin renames or edits them.
  ADD COLUMN seed_key VARCHAR(100) NULL AFTER category,
  ADD UNIQUE KEY uq_form_templates_seed_key (seed_key);
