"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import {
  createAssignment,
  deleteAssignment,
  getAssignmentOptions,
  listAssignments,
  type Assignment,
  type CustomerOption,
} from "@/lib/assignments";
import type { FieldErrors } from "@/lib/forms";
import { formatDateTime } from "@/lib/submissions";
import { EmptyState, ErrorMessage, FieldError, Loading, Notice } from "@/components/ui/parts";
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

    const result = await createAssignment(Number(data.get("professionalId")), Number(data.get("customerId")));
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
                <li key={assignment.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-semibold wrap-anywhere">{customerLabel(assignment.customer)}</p>
                    <p className="mt-0.5 text-[0.9375rem] text-ink-muted wrap-anywhere">
                      Ammattilainen: {assignment.professional.email}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-subtle">Annettu {formatDateTime(assignment.createdAt)}</p>
                  </div>
                  <button type="button" onClick={() => handleDelete(assignment)} className={dangerTextButton}>
                    Poista pääsy
                  </button>
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
          <button type="submit" disabled={pending} className={`w-full ${primaryButton}`}>
            {pending ? "Tallennetaan…" : "Anna pääsy"}
          </button>
        </form>
      </section>
    </div>
  );
}
