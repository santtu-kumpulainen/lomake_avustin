import { apiRequest, genericError, type FormField } from "./forms";
import { descriptionMessages } from "./symptoms";

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

export type FormRecommendation = { formId: number; name: string; category: string | null; reason: string };

/**
 * Asks the backend to suggest one published form for the description. Only the text is sent:
 * the backend decides the candidate forms and validates the AI's choice.
 */
export function recommendForm(description: string) {
  return apiRequest<{ recommendation: FormRecommendation | null }>(
    "POST",
    "/api/ai/recommend-form",
    { description },
    genericError,
    { description: descriptionMessages },
  );
}
