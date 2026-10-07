"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { FieldErrors } from "@/lib/forms";
import { getProfile, saveProfile, type Profile } from "@/lib/profile";
import { ErrorMessage, Loading, Notice, TextField } from "@/components/ui/parts";
import { panel, primaryButton, sectionHeading, textLink } from "@/components/ui/styles";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

export function ProfileForm() {
  // undefined = still loading.
  const [profile, setProfile] = useState<Profile>();
  const [loadStatus, setLoadStatus] = useState<number>();
  const [loadError, setLoadError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    getProfile().then((result) => {
      if (result.ok) setProfile(result.data.profile);
      else {
        setLoadStatus(result.status);
        setLoadError(result.formError);
      }
    });
  }, []);

  if (loadStatus === 401) {
    return (
      <Notice>
        Kirjaudu sisään nähdäksesi omat tietosi.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  // The backend allows the profile for customers (USER) only.
  if (loadStatus === 403) return <Notice>Omat tiedot ovat käytössä asiakkaan tunnuksilla.</Notice>;
  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (!profile) return <Loading />;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setSaved(undefined);
    setFieldErrors({});
    setFormError(undefined);

    const result = await saveProfile({
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      dateOfBirth: String(data.get("dateOfBirth") ?? ""),
      phone: String(data.get("phone") ?? ""),
    });
    setPending(false);
    if (result.ok) {
      setProfile(result.data.profile);
      setSaved(`Tiedot tallennettu klo ${formatTime(result.data.profile.updatedAt!)}.`);
      return;
    }
    setFieldErrors(result.fieldErrors);
    setFormError(result.formError);
    // Keyboard and screen reader users land on the first field that needs fixing.
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="account-heading">
        <h2 id="account-heading" className={sectionHeading}>
          Kirjautumistiedot
        </h2>
        <dl className={`mt-4 px-4 py-5 sm:px-6 ${panel}`}>
          <dt className="text-[0.9375rem] text-ink-muted">Sähköposti</dt>
          <dd className="mt-0.5 font-semibold wrap-anywhere">{profile.email}</dd>
          <dd className="mt-2 text-[0.9375rem] text-ink-muted">
            Sähköposti on kirjautumistunnuksesi, eikä sitä voi muuttaa tällä sivulla.
          </dd>
        </dl>
      </section>

      <section aria-labelledby="basic-heading">
        <h2 id="basic-heading" className={sectionHeading}>
          Perustiedot
        </h2>
        {profile.updatedAt ? (
          <p className="mt-1 text-ink-muted">
            Päivitetty viimeksi {new Date(profile.updatedAt).toLocaleString("fi-FI")}.
          </p>
        ) : (
          <p className="mt-1 text-ink-muted">Et ole vielä tallentanut perustietojasi.</p>
        )}

        {/* key resets the uncontrolled inputs to the saved values after each save. */}
        <form
          key={profile.updatedAt ?? "new"}
          ref={formRef}
          onSubmit={handleSubmit}
          noValidate
          className={`mt-4 space-y-6 px-4 py-5 sm:px-6 sm:py-6 ${panel}`}
        >
          {formError && <ErrorMessage>{formError}</ErrorMessage>}
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              name="firstName"
              label="Etunimi"
              required
              autoComplete="given-name"
              defaultValue={profile.firstName}
              error={fieldErrors.firstName}
            />
            <TextField
              name="lastName"
              label="Sukunimi"
              required
              autoComplete="family-name"
              defaultValue={profile.lastName}
              error={fieldErrors.lastName}
            />
          </div>
          <TextField
            name="dateOfBirth"
            label="Syntymäaika"
            type="date"
            optional
            autoComplete="bday"
            defaultValue={profile.dateOfBirth}
            error={fieldErrors.dateOfBirth}
          />
          <TextField
            name="phone"
            label="Puhelinnumero"
            type="tel"
            optional
            autoComplete="tel"
            hint="Esimerkiksi 040 123 4567 tai +358 40 123 4567."
            defaultValue={profile.phone}
            error={fieldErrors.phone}
          />
          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending} className={`w-full sm:w-auto ${primaryButton}`}>
              {pending ? "Tallennetaan…" : "Tallenna tiedot"}
            </button>
            <p role="status" className="font-semibold text-brand empty:hidden">
              {saved}
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}
