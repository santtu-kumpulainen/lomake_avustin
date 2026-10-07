"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import {
  createAssignment,
  deleteAssignment,
  getAssignmentOptions,
  listAssignments,
  PURPOSE_MAX,
  type Assignment,
  type CustomerOption,
} from "@/lib/assignments";
import type { FieldErrors } from "@/lib/forms";
import { formatDateTime } from "@/lib/submissions";
import { Badge, EmptyState, ErrorMessage, FieldError, Loading, Notice, TextField } from "@/components/ui/parts";
import {
  borderFor,
  dangerTextButton,
  labelClass,
  panel,
  primaryButton,
  sectionHeading,
  selectClass,
} from "@/components/ui/styles";

type Options = { professionals: { id: number; email: string }[]; customers: CustomerOption[] };

function customerLabel(customer: CustomerOption) {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  return name ? `${name} (${customer.email})` : customer.email;
}

const notGiven = <span className="text-ink-subtle italic">Ei annettu</span>;

function expiryText(assignment: Assignment) {
  if (!assignment.expiresAt) return "Voimassa toistaiseksi";
  const when = formatDateTime(assignment.expiresAt);
  return assignment.status === "EXPIRED" ? `Päättyi ${when}` : `Päättyy ${when}`;
}

/** Who may see which customer. The backend validates both roles; selectors are a convenience. */
export function AssignmentManager() {
  // undefined = still loading.
  const [assignments, setAssignments] = useState<Assignment[]>();
  const [options, setOptions] = useState<Options>();
  const [loadError, setLoadError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [pending, setPending] = useState(false);

  async function reload() {
    const result = await listAssignments();
    if (result.ok) setAssignments(result.data.assignments);
    else setLoadError(result.formError);
  }

  useEffect(() => {
    listAssignments().then((result) => {
      if (result.ok) setAssignments(result.data.assignments);
      else setLoadError(result.formError);
    });
    getAssignmentOptions().then((result) => {
      if (result.ok) setOptions(result.data);
      else setLoadError(result.formError);
    });
  }, []);

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setFieldErrors({});
    setFormError(undefined);
    setSaved(undefined);

    // A half-filled date/time input reports an empty value; catch it instead of silently
    // creating an assignment without an expiry.
    const expiresInput = form.elements.namedItem("expiresAt") as HTMLInputElement;
    if (expiresInput.validity.badInput) {
      setFieldErrors({ expiresAt: "Anna päättymisaika kokonaan: päivämäärä ja kellonaika." });
      setPending(false);
      return;
    }
    const purpose = String(data.get("purpose") ?? "").trim();
    // datetime-local is the admin's local time; toISOString sends the same instant in UTC.
    const expires = expiresInput.value ? new Date(expiresInput.value) : undefined;
    const result = await createAssignment({
      professionalId: Number(data.get("professionalId")),
      customerId: Number(data.get("customerId")),
      ...(purpose && { purpose }),
      ...(expires && { expiresAt: Number.isNaN(expires.getTime()) ? expiresInput.value : expires.toISOString() }),
    });
    if (result.ok) {
      form.reset();
      setSaved("Pääsy annettu.");
      await reload();
    } else {
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
    }
    setPending(false);
  }

  async function handleDelete(assignment: Assignment) {
    const who = `${customerLabel(assignment.customer)} / ${assignment.professional.email}`;
    if (!window.confirm(`Poistetaanko pääsy: ${who}?`)) return;
    setListError(undefined);
    setSaved(undefined);
    const result = await deleteAssignment(assignment.id);
    // 404: already removed elsewhere; the reload shows the current state either way.
    if (!result.ok && result.status !== 404) setListError(result.formError);
    await reload();
  }

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (!assignments || !options) return <Loading />;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
      <section aria-labelledby="assignments-heading">
        <h2 id="assignments-heading" className={sectionHeading}>
          Annetut pääsyt
        </h2>
        <div className="mt-4 space-y-4">
          {listError && <ErrorMessage>{listError}</ErrorMessage>}
          {assignments.length === 0 ? (
            <EmptyState title="Ammattilaisille ei ole vielä annettu pääsyä asiakkaisiin." />
          ) : (
            <ul className={`divide-y divide-line overflow-hidden ${panel}`}>
              {assignments.map((assignment) => (
                <li key={assignment.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <p className="min-w-0 font-semibold wrap-anywhere">{customerLabel(assignment.customer)}</p>
                    {assignment.status === "EXPIRED" ? (
                      <Badge>Päättynyt</Badge>
                    ) : (
                      <Badge tone="brand">Voimassa</Badge>
                    )}
                  </div>
                  <dl className="mt-2 grid gap-x-4 text-[0.9375rem] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1">
                    <dt className="text-ink-subtle">Ammattilainen</dt>
                    <dd className="wrap-anywhere">{assignment.professional.email}</dd>
                    <dt className="mt-2 text-ink-subtle sm:mt-0">Käyttötarkoitus</dt>
                    <dd className="wrap-anywhere">{assignment.purpose ?? notGiven}</dd>
                    <dt className="mt-2 text-ink-subtle sm:mt-0">Voimassaolo</dt>
                    <dd className={assignment.status === "EXPIRED" ? "font-semibold" : undefined}>{expiryText(assignment)}</dd>
                    <dt className="mt-2 text-ink-subtle sm:mt-0">Annettu</dt>
                    <dd className="wrap-anywhere">
                      {formatDateTime(assignment.createdAt)}
                      {", "}
                      {assignment.createdBy ? assignment.createdBy.email : <>antajaa ei tallennettu</>}
                    </dd>
                  </dl>
                  {assignment.status === "EXPIRED" && (
                    <p className="mt-2 text-[0.9375rem] text-ink-muted">
                      Ammattilainen ei enää näe tätä asiakasta. Uusi pääsy vaatii tämän poistamisen.
                    </p>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button type="button" onClick={() => handleDelete(assignment)} className={dangerTextButton}>
                      Poista pääsy
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="new-assignment-heading">
        <h2 id="new-assignment-heading" className={sectionHeading}>
          Anna pääsy
        </h2>
        <p className="mt-1 text-ink-muted">Ammattilainen näkee asiakkaan perustiedot, kuvaukset ja lähetetyt lomakkeet.</p>
        <form onSubmit={handleCreate} noValidate className={`mt-4 space-y-5 px-4 py-5 sm:px-5 ${panel}`}>
          {formError && <ErrorMessage>{formError}</ErrorMessage>}
          {saved && (
            <Notice tone="brand" role="status">
              {saved}
            </Notice>
          )}
          <div>
            <label htmlFor="professionalId" className={labelClass}>
              Ammattilainen
            </label>
            <select
              id="professionalId"
              name="professionalId"
              defaultValue=""
              aria-invalid={fieldErrors.professionalId ? true : undefined}
              aria-describedby={fieldErrors.professionalId ? "professionalId-error" : undefined}
              className={`${selectClass} ${borderFor(fieldErrors.professionalId)}`}
            >
              <option value="">Valitse…</option>
              {options.professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.email}
                </option>
              ))}
            </select>
            {fieldErrors.professionalId && <FieldError id="professionalId-error">{fieldErrors.professionalId}</FieldError>}
          </div>
          <div>
            <label htmlFor="customerId" className={labelClass}>
              Asiakas
            </label>
            <select
              id="customerId"
              name="customerId"
              defaultValue=""
              aria-invalid={fieldErrors.customerId ? true : undefined}
              aria-describedby={fieldErrors.customerId ? "customerId-error" : undefined}
              className={`${selectClass} ${borderFor(fieldErrors.customerId)}`}
            >
              <option value="">Valitse…</option>
              {options.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customerLabel(customer)}
                </option>
              ))}
            </select>
            {fieldErrors.customerId && <FieldError id="customerId-error">{fieldErrors.customerId}</FieldError>}
          </div>
          <TextField
            name="purpose"
            label="Käyttötarkoitus"
            optional
            hint={`Miksi ammattilainen tarvitsee pääsyn, esimerkiksi hoitojakso. Enintään ${PURPOSE_MAX} merkkiä. Älä kirjaa terveystietoja.`}
            error={fieldErrors.purpose}
          />
          <TextField
            name="expiresAt"
            label="Pääsy päättyy"
            type="datetime-local"
            optional
            hint="Tyhjä: voimassa toistaiseksi. Päättymisen jälkeen ammattilainen ei enää näe asiakasta."
            error={fieldErrors.expiresAt}
          />
          <button type="submit" disabled={pending} className={`w-full ${primaryButton}`}>
            {pending ? "Tallennetaan…" : "Anna pääsy"}
          </button>
        </form>
      </section>
    </div>
  );
}
