-- Customer profile date of birth (Issue #20).
-- Additive and nullable, so existing profile rows stay valid.
-- On an existing volume, run this file once manually (see README); never via `down -v`.

SET NAMES utf8mb4;

ALTER TABLE user_profiles
  ADD COLUMN date_of_birth DATE NULL AFTER last_name;
