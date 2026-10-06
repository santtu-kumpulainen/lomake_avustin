import { answerMessages, apiRequest, type FieldErrors, type FormField } from "./forms";

export type SubmittedForm = {
  id: number;
  formTemplateId: number;
  referenceCode: string;
  status: "SUBMITTED";
  submittedAt: string;
};

// Mirrors the backend rule; the backend still validates every submission.
const NUMBER_PATTERN = /^-?\d{1,15}([.,]\d{1,10})?$/;

/** Quick checks before sending, so missing required answers never reach the server. */
export function checkAnswers(fields: FormField[], values: Record<number, string>): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const value = (values[field.id] ?? "").trim();
    if (!value) {
      if (field.required) errors[field.id] = answerMessages.required;
    } else if (field.fieldType === "NUMBER" && !NUMBER_PATTERN.test(value)) {
      errors[field.id] = answerMessages.invalid_number;
    }
  }
  return errors;
}

export function submitForm(formTemplateId: number, answers: Record<number, string>) {
  return apiRequest<{ submission: SubmittedForm }>(
    "POST",
    "/api/submissions",
    { formTemplateId, answers },
  );
}
