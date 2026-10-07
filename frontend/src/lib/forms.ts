export type FieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT";
export type TemplateStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type FormField = {
  id: number;
  label: string;
  description: string | null;
  fieldType: FieldType;
  required: boolean;
  position: number;
  options: string[] | null;
};

export type FormTemplate = {
  id: number;
  name: string;
  description: string | null;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
  fields: FormField[];
};

export type TemplateSummary = Omit<FormTemplate, "fields"> & { fieldCount: number };

export type FieldInput = {
  label: string;
  description: string | null;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
};

export const fieldTypeLabels: Record<FieldType, string> = {
  TEXT: "Teksti",
  NUMBER: "Numero",
  DATE: "Päivämäärä",
  SELECT: "Valinta",
};

export const statusLabels: Record<TemplateStatus, string> = {
  DRAFT: "Luonnos",
  PUBLISHED: "Julkaistu",
  ARCHIVED: "Arkistoitu",
};

// Backend returns field error codes; the UI owns the wording.
const fieldMessages: Record<string, Record<string, string>> = {
  name: {
    required: "Nimi on pakollinen.",
    too_long: "Nimi voi olla enintään 200 merkkiä.",
  },
  label: {
    required: "Kysymys on pakollinen.",
    too_long: "Kysymys voi olla enintään 255 merkkiä.",
  },
  description: {
    too_long: "Kuvaus voi olla enintään 2000 merkkiä.",
  },
  fieldType: {
    required: "Valitse kentän tyyppi.",
    invalid: "Valitse kentän tyyppi.",
  },
  options: {
    required: "Valintakentällä on oltava vähintään yksi vaihtoehto.",
    empty_option: "Vaihtoehto ei voi olla tyhjä.",
    duplicate: "Sama vaihtoehto on annettu useammin kuin kerran.",
    too_many: "Vaihtoehtoja voi olla enintään 50.",
    too_long: "Vaihtoehto voi olla enintään 200 merkkiä.",
    not_allowed: "Vain valintakentällä voi olla vaihtoehtoja.",
  },
  required: {
    invalid: "Valitse, onko kenttä pakollinen.",
  },
  fieldIds: {
    invalid: "Kenttien järjestys on vanhentunut. Lataa sivu uudelleen.",
  },
};

// Codes from validating a user's answers (POST /api/submissions).
export const answerMessages: Record<string, string> = {
  required: "Tämä kenttä on pakollinen.",
  invalid_number: "Anna luku, esimerkiksi 72 tai 72,5.",
  invalid_date: "Anna kelvollinen päivämäärä.",
  invalid_option: "Valitse jokin annetuista vaihtoehdoista.",
  too_long: "Vastaus on liian pitkä (enintään 5000 merkkiä).",
  unknown_field: "Lomake on muuttunut. Lataa sivu uudelleen.",
  invalid: "Tarkista vastaus.",
};

export type FieldErrors = Record<string, string>;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; fieldErrors: FieldErrors; formError?: string };

export const genericError = "Jotain meni pieleen. Yritä uudelleen.";

const statusMessages: Record<number, string> = {
  401: "Istunto on päättynyt. Kirjaudu uudelleen sisään.",
  403: "Sinulla ei ole oikeutta tähän toimintoon.",
  404: "Lomaketta tai kenttää ei löytynyt.",
};

/**
 * `conflictMessage` is shown for 409, whose cause depends on the action
 * (publishing without fields, editing a published template, deleting a used template).
 * `messages` translates field error codes of other resources (e.g. the profile).
 */
export async function apiRequest<T>(
  method: string,
  url: string,
  body?: unknown,
  conflictMessage = genericError,
  messages?: Record<string, Record<string, string>>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, fieldErrors: {}, formError: genericError };
  }

  if (res.status === 204) return { ok: true, data: undefined as T };
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: json as T };

  if (res.status === 400 && json.fields) {
    const fieldErrors: FieldErrors = {};
    for (const [field, code] of Object.entries(json.fields as Record<string, string>)) {
      // Answer errors are keyed by field id, so they are translated by code alone.
      fieldErrors[field] =
        messages?.[field]?.[code] ?? fieldMessages[field]?.[code] ?? answerMessages[code] ?? genericError;
    }
    return { ok: false, status: 400, fieldErrors };
  }
  const formError = res.status === 409 ? conflictMessage : (statusMessages[res.status] ?? genericError);
  return { ok: false, status: res.status, fieldErrors: {}, formError };
}

function api<T>(method: string, path: string, body?: unknown, conflictMessage?: string) {
  return apiRequest<T>(method, `/api/forms${path}`, body, conflictMessage);
}

const editConflict = "Julkaistua lomakepohjaa ei voi muokata. Palauta se ensin luonnokseksi.";

type TemplateResponse = { template: FormTemplate };

export function listTemplates() {
  return api<{ templates: TemplateSummary[] }>("GET", "");
}

export function getTemplate(id: number) {
  return api<TemplateResponse>("GET", `/${id}`);
}

export function createTemplate(input: { name: string; description: string | null }) {
  return api<TemplateResponse>("POST", "", input);
}

export function updateTemplate(id: number, input: { name: string; description: string | null }) {
  return api<TemplateResponse>("PATCH", `/${id}`, input, editConflict);
}

export function deleteTemplate(id: number) {
  return api<void>(
    "DELETE",
    `/${id}`,
    undefined,
    "Lomakepohjaa ei voi poistaa, koska sillä on vastauksia tai se on julkaistu.",
  );
}

export function publishTemplate(id: number) {
  return api<TemplateResponse>(
    "POST",
    `/${id}/publish`,
    undefined,
    "Lisää vähintään yksi kenttä ennen julkaisua.",
  );
}

export function unpublishTemplate(id: number) {
  return api<TemplateResponse>("POST", `/${id}/unpublish`);
}

export function addField(templateId: number, input: FieldInput) {
  return api<TemplateResponse>("POST", `/${templateId}/fields`, input, editConflict);
}

export function updateField(templateId: number, fieldId: number, input: FieldInput) {
  return api<TemplateResponse>("PATCH", `/${templateId}/fields/${fieldId}`, input, editConflict);
}

export function deleteField(templateId: number, fieldId: number) {
  return api<TemplateResponse>(
    "DELETE",
    `/${templateId}/fields/${fieldId}`,
    undefined,
    "Kenttää ei voi poistaa, koska siihen on tallennettu vastauksia.",
  );
}

export function reorderFields(templateId: number, fieldIds: number[]) {
  return api<TemplateResponse>("PUT", `/${templateId}/fields/order`, { fieldIds }, editConflict);
}
