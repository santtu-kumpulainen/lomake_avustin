import { apiRequest } from "./forms";

// ADMIN management of professional -> customer assignments (Issue #32).

type Person = { id: number; email: string };
export type CustomerOption = Person & { firstName: string | null; lastName: string | null };

export type Assignment = {
  id: number;
  createdAt: string;
  professional: Person;
  customer: CustomerOption;
};

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
};

export function listAssignments() {
  return apiRequest<{ assignments: Assignment[] }>("GET", base);
}

export function getAssignmentOptions() {
  return apiRequest<{ professionals: Person[]; customers: CustomerOption[] }>("GET", `${base}/options`);
}

export function createAssignment(professionalId: number, customerId: number) {
  return apiRequest<{ assignment: { id: number } }>(
    "POST",
    base,
    { professionalId, customerId },
    "Ammattilaiselle on jo annettu pääsy tähän asiakkaaseen.",
    assignmentMessages,
  );
}

export function deleteAssignment(id: number) {
  return apiRequest<void>("DELETE", `${base}/${id}`);
}
