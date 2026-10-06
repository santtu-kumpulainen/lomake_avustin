// Validates submitted answers against the field definitions stored in the database.
// Error codes are keyed by field id; the UI owns the wording.
import type { FieldType } from "../forms/validation.js";

export type FieldErrors = Record<string, string>;

export type FieldDefinition = {
  id: number;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
};

export type Answer = { fieldId: number; value: string };

const TEXT_MAX = 5000;
// Accepts a Finnish decimal comma; stored with a dot so later code can parse it uniformly.
const NUMBER_PATTERN = /^-?\d{1,15}([.,]\d{1,10})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC rolls over invalid days (e.g. 2026-02-30), so compare the parts back.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Returns a normalized value, or an error code. */
function checkValue(field: FieldDefinition, value: string): { value: string } | { error: string } {
  switch (field.fieldType) {
    case "TEXT":
      return value.length > TEXT_MAX ? { error: "too_long" } : { value };
    case "NUMBER":
      return NUMBER_PATTERN.test(value)
        ? { value: value.replace(",", ".") }
        : { error: "invalid_number" };
    case "DATE":
      return isRealDate(value) ? { value } : { error: "invalid_date" };
    case "SELECT":
      return field.options?.includes(value) ? { value } : { error: "invalid_option" };
  }
}

/**
 * `body` is `{ [fieldId]: string | null }`. Empty optional answers are skipped, so only
 * real answers are stored. Ids that are not fields of this template are rejected.
 */
export function validateAnswers(
  body: unknown,
  fields: FieldDefinition[],
): { answers: Answer[]; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const answers: Answer[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { answers, errors: { answers: "invalid" } };
  }
  const input = body as Record<string, unknown>;
  const byId = new Map(fields.map((field) => [String(field.id), field]));

  for (const key of Object.keys(input)) {
    if (!byId.has(key)) errors[key] = "unknown_field";
  }

  for (const field of fields) {
    const key = String(field.id);
    const raw = input[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      errors[key] = "invalid";
      continue;
    }
    const value = (raw ?? "").trim();
    if (!value) {
      if (field.required) errors[key] = "required";
      continue;
    }
    const result = checkValue(field, value);
    if ("error" in result) errors[key] = result.error;
    else answers.push({ fieldId: field.id, value: result.value });
  }

  return { answers, errors };
}
