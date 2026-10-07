import { answerMessages, apiRequest, type FieldErrors, type FieldType, type FormField } from "./forms";

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
  // For a submitted form, questions left empty are included with a null value.
  answers: { fieldId: number; label: string; fieldType: FieldType; value: string | null }[];
};

export type SubmittedSummary = {
  id: number;
  formTemplateId: number;
  formName: string;
  status: "SUBMITTED";
  referenceCode: string;
  submittedAt: string;
};

/** The user's own submitted forms, newest first. */
export function listSubmissions() {
  return apiRequest<{ submissions: SubmittedSummary[] }>("GET", "/api/submissions");
}

/** Submission time in Finnish format, e.g. "7.10.2026 klo 14.05". */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fi-FI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Readable answer for summaries and receipts, or undefined when nothing was given. */
export function formatAnswer(fieldType: FieldType, value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (fieldType === "DATE") {
    // Parsed by hand so the shown day never shifts with the time zone.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) return `${Number(match[3])}.${Number(match[2])}.${match[1]}`;
  }
  // Stored with a dot; shown with the Finnish decimal comma.
  if (fieldType === "NUMBER") return trimmed.replace(".", ",");
  // SELECT values are the option texts themselves, so they are already readable.
  return trimmed;
}

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
