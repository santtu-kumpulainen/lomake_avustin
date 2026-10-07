import { apiRequest, genericError } from "./forms";

export type Profile = {
  // Login identity from the account; read-only here.
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  updatedAt: string | null;
};

export type ProfileInput = Pick<Profile, "firstName" | "lastName" | "dateOfBirth" | "phone">;

// Backend returns field error codes; the UI owns the wording.
const profileMessages: Record<string, Record<string, string>> = {
  firstName: {
    required: "Etunimi on pakollinen.",
    too_long: "Etunimi voi olla enintään 100 merkkiä.",
    invalid: "Tarkista etunimi.",
  },
  lastName: {
    required: "Sukunimi on pakollinen.",
    too_long: "Sukunimi voi olla enintään 100 merkkiä.",
    invalid: "Tarkista sukunimi.",
  },
  dateOfBirth: {
    invalid_date: "Anna kelvollinen päivämäärä.",
    out_of_range: "Syntymäajan on oltava vuoden 1900 jälkeen eikä tulevaisuudessa.",
    invalid: "Anna kelvollinen päivämäärä.",
  },
  phone: {
    invalid: "Anna puhelinnumero numeroina, esimerkiksi 040 123 4567 tai +358 40 123 4567.",
    too_long: "Puhelinnumero voi olla enintään 30 merkkiä.",
  },
};

export function getProfile() {
  return apiRequest<{ profile: Profile }>("GET", "/api/profile");
}

/** Replaces the user's own profile. Empty optional values are saved as not given. */
export function saveProfile(input: ProfileInput) {
  return apiRequest<{ profile: Profile }>("PUT", "/api/profile", input, genericError, profileMessages);
}
