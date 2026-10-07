import { apiRequest, genericError } from "./forms";

export type SymptomDescription = {
  id: number;
  description: string;
  createdAt: string;
};

// Same limits as the backend, which always validates again.
export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 2000;

// Backend returns field error codes; the UI owns the wording.
export const descriptionMessages: Record<string, string> = {
  required: "Kirjoita kuvaus ennen tallentamista.",
  too_short: `Kirjoita vähintään ${DESCRIPTION_MIN} merkkiä.`,
  too_long: `Kuvaus voi olla enintään ${DESCRIPTION_MAX} merkkiä.`,
  invalid: "Kuvauksessa on merkkejä, joita ei voi tallentaa.",
};

export function listSymptomDescriptions() {
  return apiRequest<{ symptomDescriptions: SymptomDescription[] }>("GET", "/api/symptom-descriptions");
}

/** Saves a new description for the signed-in user; the owner comes from the session. */
export function createSymptomDescription(description: string) {
  return apiRequest<{ symptomDescription: SymptomDescription }>(
    "POST",
    "/api/symptom-descriptions",
    { description },
    genericError,
    { description: descriptionMessages },
  );
}

/** Same checks as the backend, so obvious mistakes are caught without a request. */
export function checkDescription(text: string): string | undefined {
  const length = text.trim().length;
  if (length === 0) return descriptionMessages.required;
  if (length < DESCRIPTION_MIN) return descriptionMessages.too_short;
  if (length > DESCRIPTION_MAX) return descriptionMessages.too_long;
  return undefined;
}
