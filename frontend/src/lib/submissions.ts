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

export type DraftSummary = {
  id: number;
  formTemplateId: number;
  formName: string;
  formAvailable: boolean;
  answerCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Submission = {
  id: number;
  formTemplateId: number;
  formName: string;
  formAvailable: boolean;
  status: "DRAFT" | "SUBMITTED";
  // Null for drafts; the code is a receipt only after submitting.
  referenceCode: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  answers: { fieldId: number; label: string; value: string | null }[];
};

const draftConflict =
  "Luonnosta ei voi enää muuttaa: se on jo lähetetty tai lomake ei ole tällä hetkellä käytettävissä.";

export function listDrafts() {
  return apiRequest<{ drafts: DraftSummary[] }>("GET", "/api/submissions/drafts");
}

export function getSubmission(id: number) {
  return apiRequest<{ submission: Submission }>("GET", `/api/submissions/${id}`);
}

/** Creates a draft, or updates `draftId`. Empty values clear saved answers. */
export function saveDraft(
  formTemplateId: number,
  draftId: number | undefined,
  answers: Record<number, string>,
) {
  return apiRequest<{ submission: Submission }>(
    "POST",
    "/api/submissions/draft",
    draftId ? { id: draftId, answers } : { formTemplateId, answers },
    draftConflict,
  );
}

/** Saves the latest answers and submits the draft in one request. */
export function submitDraft(draftId: number, answers: Record<number, string>) {
  return apiRequest<{ submission: Submission }>(
    "POST",
    `/api/submissions/${draftId}/submit`,
    { answers },
    draftConflict,
  );
}

export type PreviousData = {
  // When the source submission was sent; null if nothing can be prefilled.
  submittedAt: string | null;
  answers: { fieldId: number; value: string }[];
};

/** Whether the user's own earlier submissions can prefill this form. Returns no values. */
export function getPreviousDataAvailability(formTemplateId: number) {
  return apiRequest<{ available: boolean; fieldCount: number }>(
    "GET",
    `/api/submissions/previous-data/available?formTemplateId=${formTemplateId}`,
  );
}

/** The values themselves. Call only after the user has agreed to use them. */
export function getPreviousData(formTemplateId: number) {
  return apiRequest<{ previousData: PreviousData }>(
    "GET",
    `/api/submissions/previous-data?formTemplateId=${formTemplateId}`,
  );
}
