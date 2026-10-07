import { apiRequest } from "./forms";

// ADMIN management of professional -> customer assignments (Issue #32), with metadata (Issue #38).

type Person = { id: number; email: string };
export type CustomerOption = Person & { firstName: string | null; lastName: string | null };

export type Assignment = {
  id: number;
  createdAt: string;
  professional: Person;
  customer: CustomerOption;
  purpose: string | null;
  // Null = no expiry.
  expiresAt: string | null;
  // Null when the creator was not recorded (made before Issue #38) or the admin was deleted.
  createdBy: Person | null;
  // Decided by the backend with the database clock; expired assignments grant no access.
  status: "ACTIVE" | "EXPIRED";
};

export type NewAssignment = {
  professionalId: number;
  customerId: number;
  purpose?: string;
  // ISO 8601 with an offset; the backend rejects anything else.
  expiresAt?: string;
};

export const PURPOSE_MAX = 300;

const base = "/api/admin/professional-customers";

const assignmentMessages: Record<string, Record<string, string>> = {
  professionalId: {
    required: "Valitse ammattilainen.",
    invalid: "Valitse ammattilainen.",
    not_found: "Ammattilaista ei löytynyt. Lataa sivu uudelleen.",
    invalid_role: "Valittu tili ei ole ammattilainen.",
  },
  customerId: {
    required: "Valitse asiakas.",
    invalid: "Valitse asiakas.",
    not_found: "Asiakasta ei löytynyt. Lataa sivu uudelleen.",
    invalid_role: "Valittu tili ei ole asiakas.",
  },
  purpose: {
    invalid: "Käyttötarkoitus voi olla vain yksirivistä tekstiä.",
    too_long: `Käyttötarkoitus voi olla enintään ${PURPOSE_MAX} merkkiä.`,
  },
  expiresAt: {
    invalid: "Anna päättymisaika kokonaan: päivämäärä ja kellonaika.",
    in_past: "Päättymisajan on oltava tulevaisuudessa.",
  },
};

export function listAssignments() {
  return apiRequest<{ assignments: Assignment[] }>("GET", base);
}

export function getAssignmentOptions() {
  return apiRequest<{ professionals: Person[]; customers: CustomerOption[] }>("GET", `${base}/options`);
}

export function createAssignment(input: NewAssignment) {
  return apiRequest<{ assignment: { id: number } }>(
    "POST",
    base,
    input,
    // The pair is unique also after expiry, so an expired assignment must be removed first.
    "Ammattilaisella on jo voimassa oleva tai päättynyt pääsy tähän asiakkaaseen. Poista vanha pääsy ensin.",
    assignmentMessages,
  );
}

export function deleteAssignment(id: number) {
  return apiRequest<void>("DELETE", `${base}/${id}`);
}
