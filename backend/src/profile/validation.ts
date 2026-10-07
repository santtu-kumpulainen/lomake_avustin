import { isRealDate } from "../submissions/answers.js";

export type FieldErrors = Record<string, string>;

export type ProfileInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
};

// Same limits as the user_profiles columns.
const NAME_MAX = 100;
const PHONE_MAX = 30;
const ALLOWED_KEYS = new Set(["firstName", "lastName", "dateOfBirth", "phone"]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Digits with optional leading +, spaces, dashes and parentheses, e.g. "+358 40 123 4567".
const PHONE_PATTERN = /^\+?[0-9 ()-]+$/;
const EARLIEST_BIRTH_DATE = "1900-01-01";

function readName(value: unknown, errors: FieldErrors, key: string): string {
  if (value !== undefined && typeof value !== "string") {
    errors[key] = "invalid";
    return "";
  }
  const text = (value ?? "").trim();
  if (!text) errors[key] = "required";
  else if (text.length > NAME_MAX) errors[key] = "too_long";
  else if (CONTROL_CHARS.test(text)) errors[key] = "invalid";
  return text;
}

// Empty or missing optional values become NULL, so "not given" has one representation.
function readOptional(value: unknown, errors: FieldErrors, key: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors[key] = "invalid";
    return null;
  }
  return value.trim() || null;
}

/**
 * PUT replaces the whole profile. Ownership comes from the session only, so any other key
 * (userId, user_id, email, role...) is rejected rather than ignored, and callers notice.
 */
export function validateProfile(
  body: unknown,
  today: string = new Date().toISOString().slice(0, 10),
): { ok: true; input: ProfileInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const data =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS.has(key)) errors[key] = "not_allowed";
  }

  const firstName = readName(data.firstName, errors, "firstName");
  const lastName = readName(data.lastName, errors, "lastName");

  const dateOfBirth = readOptional(data.dateOfBirth, errors, "dateOfBirth");
  if (dateOfBirth !== null) {
    if (!isRealDate(dateOfBirth)) errors.dateOfBirth = "invalid_date";
    // ISO dates compare correctly as strings.
    else if (dateOfBirth > today || dateOfBirth < EARLIEST_BIRTH_DATE) errors.dateOfBirth = "out_of_range";
  }

  const phone = readOptional(data.phone, errors, "phone");
  if (phone !== null) {
    const digits = phone.replace(/\D/g, "").length;
    if (phone.length > PHONE_MAX) errors.phone = "too_long";
    // E.164 numbers have at most 15 digits.
    else if (!PHONE_PATTERN.test(phone) || digits < 5 || digits > 15) errors.phone = "invalid";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { firstName, lastName, dateOfBirth, phone } };
}
