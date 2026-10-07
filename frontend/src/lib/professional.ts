import { apiRequest } from "./forms";
import type { Submission } from "./submissions";

export type ProfessionalDashboard = {
  // Customers' submitted forms only; drafts and staff accounts are not counted.
  submittedForms: { today: number; last7Days: number; total: number };
  // At most 10 forms, most submitted first.
  formsLast7Days: { formTemplateId: number; name: string; category: string | null; submittedForms: number }[];
};

/** Aggregate counts for the professional dashboard. Contains no customer data. */
export function getProfessionalDashboard() {
  return apiRequest<{ dashboard: ProfessionalDashboard }>("GET", "/api/professional/dashboard");
}

// Customer access (Issue #32). Every route below returns data only for customers explicitly
// assigned to the signed-in professional; anything else is a 404.

export type AssignedCustomer = {
  id: number;
  // Null until the customer has saved their profile.
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
};

export type CustomerProfile = AssignedCustomer & { phone: string | null };

// Newest first, ordered by the backend (database time, then a fixed tie-break). Built only from
// the customer's symptom descriptions and submitted forms; drafts are never included.
export type TimelineEvent =
  | { type: "SYMPTOM_DESCRIPTION"; occurredAt: string; description: string }
  | { type: "SUBMISSION"; occurredAt: string; submissionId: number; formName: string; answerCount: number };

/** Display name, or a neutral label with the customer number when no profile exists yet. */
export function customerName(customer: Pick<AssignedCustomer, "id" | "firstName" | "lastName">) {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  return name || `Asiakas ${customer.id} (ei nimeä)`;
}

/** YYYY-MM-DD as a Finnish date, parsed by hand so the day never shifts with the time zone. */
export function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[3])}.${Number(match[2])}.${match[1]}` : value;
}

const base = "/api/professional/customers";

export function listAssignedCustomers() {
  return apiRequest<{ customers: AssignedCustomer[] }>("GET", base);
}

// Why and until when the professional may see this customer (Issue #38). Expired assignments
// never reach the browser: the backend answers 404 for them.
export type CustomerAccess = { purpose: string | null; expiresAt: string | null };

export function getCustomer(id: number) {
  return apiRequest<{ customer: CustomerProfile; access: CustomerAccess }>("GET", `${base}/${id}`);
}

export function getCustomerTimeline(id: number) {
  return apiRequest<{ timeline: TimelineEvent[] }>("GET", `${base}/${id}/timeline`);
}

export type CustomerSubmission = Pick<
  Submission,
  "id" | "formTemplateId" | "formName" | "referenceCode" | "answers"
> & { status: "SUBMITTED"; submittedAt: string };

export function getCustomerSubmission(customerId: number, submissionId: number) {
  return apiRequest<{ submission: CustomerSubmission }>("GET", `${base}/${customerId}/submissions/${submissionId}`);
}
