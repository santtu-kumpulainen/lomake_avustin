// Validation for the customer's own description of why they are seeking help.
// Only form is checked (type, length, characters); the content is never interpreted.

export type FieldErrors = Record<string, string>;

export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 2000;
// Control characters other than tab, line feed and carriage return, which a textarea can produce.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * The body may only contain `description`. Ownership comes from the session, so any other key
 * (userId, user_id, createdAt...) is rejected rather than ignored, and callers notice.
 */
export function validateSymptomDescription(
  body: unknown,
): { ok: true; description: string } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const data =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  for (const key of Object.keys(data)) {
    if (key !== "description") errors[key] = "not_allowed";
  }

  const value = data.description;
  let description = "";
  if (value !== undefined && value !== null && typeof value !== "string") {
    errors.description = "invalid";
  } else {
    description = (value ?? "").trim();
    if (!description) errors.description = "required";
    else if (description.length < DESCRIPTION_MIN) errors.description = "too_short";
    else if (description.length > DESCRIPTION_MAX) errors.description = "too_long";
    else if (CONTROL_CHARS.test(description)) errors.description = "invalid";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, description };
}
