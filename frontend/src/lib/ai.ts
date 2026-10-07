import { apiRequest, type FormField } from "./forms";

/**
 * Asks the backend to explain one question. Only the question's own metadata is sent,
 * never the user's answer or any other data (privacy boundary, requirement 4.5).
 */
export function explainQuestion(field: FormField) {
  return apiRequest<{ explanation: string }>("POST", "/api/ai/explain", {
    question: field.label,
    description: field.description,
    fieldType: field.fieldType,
    ...(field.fieldType === "SELECT" && field.options ? { options: field.options } : {}),
  });
}
