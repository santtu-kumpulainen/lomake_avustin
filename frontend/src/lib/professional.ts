import { apiRequest } from "./forms";

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
