export type Role = "USER" | "ADMIN" | "PROFESSIONAL";

export type User = {
  id: number;
  email: string;
  role: Role;
};

export const roleLabels: Record<Role, string> = {
  USER: "Käyttäjä",
  ADMIN: "Ylläpitäjä",
  PROFESSIONAL: "Ammattilainen",
};

// Backend returns field error codes; the UI owns the wording.
const fieldMessages: Record<string, Record<string, string>> = {
  email: {
    required: "Sähköposti on pakollinen.",
    invalid: "Tarkista sähköpostiosoitteen muoto.",
    taken: "Tällä sähköpostilla on jo tili.",
  },
  password: {
    required: "Salasana on pakollinen.",
    too_short: "Salasanan on oltava vähintään 10 merkkiä.",
    too_long: "Salasana voi olla enintään 128 merkkiä.",
  },
};

export type FieldErrors = Partial<Record<"email" | "password", string>>;

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; fieldErrors: FieldErrors; formError?: string };

const genericError = "Jotain meni pieleen. Yritä uudelleen.";

export async function submitCredentials(
  mode: "login" | "register",
  email: string,
  password: string,
): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, fieldErrors: {}, formError: genericError };
  }

  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, user: body.user };

  if (res.status === 401) {
    return { ok: false, fieldErrors: {}, formError: "Sähköposti tai salasana on virheellinen." };
  }
  if (body.fields) {
    const fieldErrors: FieldErrors = {};
    for (const [field, code] of Object.entries(body.fields as Record<string, string>)) {
      if (field === "email" || field === "password") {
        fieldErrors[field] = fieldMessages[field][code] ?? genericError;
      }
    }
    return { ok: false, fieldErrors };
  }
  return { ok: false, fieldErrors: {}, formError: genericError };
}

export async function fetchCurrentUser(): Promise<User | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()).user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
