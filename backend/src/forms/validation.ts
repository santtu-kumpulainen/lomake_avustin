// Input validation for form templates and fields. Returns field error codes; the UI owns the wording.

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "SELECT"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldErrors = Record<string, string>;

const NAME_MAX = 200;
const CATEGORY_MAX = 100;
const LABEL_MAX = 255;
const DESCRIPTION_MAX = 2000;
const OPTION_MAX = 200;
const OPTIONS_MAX_COUNT = 50;

export type TemplateInput = { name: string; description: string | null; category: string | null };

export type FieldInput = {
  label: string;
  description: string | null;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
};

function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function readRequiredText(value: unknown, max: number, errors: FieldErrors, key: string): string {
  if (value !== undefined && typeof value !== "string") {
    errors[key] = "invalid";
    return "";
  }
  const text = (value ?? "").trim();
  if (!text) errors[key] = "required";
  else if (text.length > max) errors[key] = "too_long";
  return text;
}

// Empty strings become NULL so "no description" has one representation.
function readOptionalText(
  value: unknown,
  errors: FieldErrors,
  key: string,
  max = DESCRIPTION_MAX,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors[key] = "invalid";
    return null;
  }
  const text = value.trim();
  if (text.length > max) errors[key] = "too_long";
  return text || null;
}

function readOptions(value: unknown, errors: FieldErrors): string[] | null {
  if (!Array.isArray(value) || value.some((option) => typeof option !== "string")) {
    errors.options = "invalid";
    return null;
  }
  const options = (value as string[]).map((option) => option.trim());
  if (options.length === 0) errors.options = "required";
  else if (options.length > OPTIONS_MAX_COUNT) errors.options = "too_many";
  else if (options.some((option) => !option)) errors.options = "empty_option";
  else if (options.some((option) => option.length > OPTION_MAX)) errors.options = "too_long";
  // Answers are stored as the option text, so duplicates would be ambiguous.
  else if (new Set(options).size !== options.length) errors.options = "duplicate";
  return options;
}

/** Validates a full template, or a partial one for PATCH merged over the current values. */
export function validateTemplate(
  body: unknown,
  current?: TemplateInput,
): { value: TemplateInput; errors: FieldErrors } {
  const data = asObject(body);
  const errors: FieldErrors = {};
  const name =
    current && data.name === undefined
      ? current.name
      : readRequiredText(data.name, NAME_MAX, errors, "name");
  const description =
    current && data.description === undefined
      ? current.description
      : readOptionalText(data.description, errors, "description");
  const category =
    current && data.category === undefined
      ? current.category
      : readOptionalText(data.category, errors, "category", CATEGORY_MAX);
  return { value: { name, description, category }, errors };
}

/** Validates a full field, or a partial one for PATCH merged over the current values. */
export function validateField(
  body: unknown,
  current?: FieldInput,
): { value: FieldInput; errors: FieldErrors } {
  const data = asObject(body);
  const errors: FieldErrors = {};

  const label =
    current && data.label === undefined
      ? current.label
      : readRequiredText(data.label, LABEL_MAX, errors, "label");
  const description =
    current && data.description === undefined
      ? current.description
      : readOptionalText(data.description, errors, "description");

  let fieldType: FieldType = current?.fieldType ?? "TEXT";
  if (!current || data.fieldType !== undefined) {
    if (data.fieldType === undefined) errors.fieldType = "required";
    else if (!FIELD_TYPES.includes(data.fieldType as FieldType)) errors.fieldType = "invalid";
    else fieldType = data.fieldType as FieldType;
  }

  let required = current?.required ?? false;
  if (data.required !== undefined) {
    if (typeof data.required !== "boolean") errors.required = "invalid";
    else required = data.required;
  }

  let options: string[] | null = null;
  if (!errors.fieldType) {
    if (fieldType === "SELECT") {
      if (data.options !== undefined && data.options !== null) options = readOptions(data.options, errors);
      else if (current?.fieldType === "SELECT" && data.options === undefined) options = current.options;
      else errors.options = "required";
    } else if (data.options !== undefined && data.options !== null) {
      errors.options = "not_allowed";
    }
    // Otherwise options stay NULL, which also drops them when a SELECT changes to another type.
  }

  return { value: { label, description, fieldType, required, options }, errors };
}

/** Field ids in the new order. Must be exactly the template's current field ids. */
export function validateFieldOrder(body: unknown, existingIds: number[]): number[] | null {
  const fieldIds = asObject(body).fieldIds;
  if (!Array.isArray(fieldIds) || !fieldIds.every((id) => Number.isInteger(id))) return null;
  const ids = fieldIds as number[];
  const existing = new Set(existingIds);
  if (ids.length !== existing.size || new Set(ids).size !== ids.length) return null;
  return ids.every((id) => existing.has(id)) ? ids : null;
}

/** Route ids as positive integers; anything else is treated as not found. */
export function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= 4294967295 ? id : null;
}
