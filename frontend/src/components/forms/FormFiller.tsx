"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import {
  getTemplate,
  type ApiResult,
  type FieldErrors,
  type FormField,
  type FormTemplate,
} from "@/lib/forms";
import {
  checkAnswers,
  getPreviousData,
  getPreviousDataAvailability,
  getSubmission,
  saveDraft,
  submitDraft,
  submitForm,
  type Submission,
} from "@/lib/submissions";
import { QuestionHelp, useQuestionHelp } from "@/components/forms/QuestionHelp";
import { Badge, ErrorMessage, FieldError, Loading, Notice, PageHeader } from "@/components/ui/parts";
import {
  borderFor,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  sectionHeading,
  selectClass,
  textButton,
} from "@/components/ui/styles";

const fieldId = (field: FormField) => `field-${field.id}`;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

type Receipt = { referenceCode: string; submittedAt: string };

// "offered": waiting for the user's choice. Nothing is fetched or filled before "accepted".
type PrefillState =
  | { step: "offered"; fieldCount: number }
  | { step: "loading"; fieldCount: number }
  | { step: "accepted"; filled: number; kept: number; submittedAt: string | null }
  | { step: "declined" }
  | { step: "failed" };

/** `draftId` resumes a saved draft; without it the form starts empty. */
export function FormFiller({ id, draftId }: { id: number; draftId?: number }) {
  const router = useRouter();
  // undefined = still loading.
  const [template, setTemplate] = useState<FormTemplate>();
  const [loadError, setLoadError] = useState<string>();
  // Answers live in state, so nothing the user typed is lost when validation fails.
  const [values, setValues] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState<"submit" | "draft">();
  const [submitted, setSubmitted] = useState<Receipt>();
  // The saved draft being edited, if any, and the confirmation shown after saving.
  const [draft, setDraft] = useState<{ id: number; updatedAt: string }>();
  const [draftNotice, setDraftNotice] = useState<string>();
  const [prefill, setPrefill] = useState<PrefillState>();
  // Fields still showing a value taken from previous data; editing a field removes its mark.
  const [prefilledIds, setPrefilledIds] = useState<Set<number>>(new Set());
  // "review" shows the summary; nothing is sent to the server until the user confirms there.
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  // Element to focus after the next step change (review heading or a field to edit).
  const focusAfterStep = useRef<string>(undefined);

  useEffect(() => {
    async function load() {
      // A resumed draft keeps its own answers, so prefill is only offered on a new form.
      const [templateResult, draftResult, previousResult] = await Promise.all([
        getTemplate(id),
        draftId ? getSubmission(draftId) : undefined,
        draftId ? undefined : getPreviousDataAvailability(id),
      ]);
      if (!templateResult.ok) {
        setLoadError(templateResult.formError);
        return;
      }
      if (draftResult) {
        const saved = draftResult.ok ? draftResult.data.submission : undefined;
        if (!saved || saved.formTemplateId !== id) {
          setLoadError("Luonnosta ei löytynyt.");
          return;
        }
        if (saved.status === "SUBMITTED") {
          setLoadError(`Tämä lomake on jo lähetetty. Viitekoodi: ${saved.referenceCode}.`);
          return;
        }
        setDraft({ id: saved.id, updatedAt: saved.updatedAt });
        setValues(Object.fromEntries(saved.answers.map((answer) => [answer.fieldId, answer.value ?? ""])));
      }
      // A failed check just means no offer; the form works the same without it.
      if (previousResult?.ok && previousResult.data.available) {
        setPrefill({ step: "offered", fieldCount: previousResult.data.fieldCount });
      }
      setTemplate(templateResult.data.template);
    }
    load();
  }, [id, draftId]);

  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  useEffect(() => {
    const target = focusAfterStep.current;
    focusAfterStep.current = undefined;
    if (!target) return;
    const element = target === "review" ? reviewRef.current : document.getElementById(target);
    element?.focus();
    element?.scrollIntoView({ block: "center" });
  }, [step]);

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (!template) return <Loading />;

  if (submitted) {
    return (
      <section aria-labelledby="success-heading" className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-start gap-4 border-b border-brand/20 bg-brand-tint px-5 py-6 sm:px-8">
          <svg aria-hidden="true" width="32" height="32" viewBox="0 0 32 32" className="mt-0.5 shrink-0">
            <circle cx="16" cy="16" r="16" fill="#1d5245" />
            <path d="m10 16.5 4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
            <h1
              id="success-heading"
              ref={successRef}
              tabIndex={-1}
              className="text-[1.75rem] leading-tight font-bold tracking-tight outline-none sm:text-[2rem]"
            >
              Lomake lähetetty
            </h1>
            <p className="mt-1 text-ink-muted wrap-break-word">{template.name}</p>
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-5 px-5 py-6 sm:grid-cols-[auto_1fr] sm:px-8">
          <dt className="font-semibold sm:pt-0.5">Tila</dt>
          <dd>
            <Badge tone="brand">Lähetetty</Badge>
          </dd>
          <dt className="font-semibold sm:pt-2">Viitekoodi</dt>
          <dd>
            <p className="font-mono text-[2rem] leading-none font-bold tracking-[0.03em] text-ink sm:text-[2.5rem]">
              {submitted.referenceCode}
            </p>
            <p className="mt-2 max-w-[34rem] text-[0.9375rem] text-ink-muted">
              Säilytä viitekoodi. Sillä lomakkeesi löytyy, jos otat yhteyttä.
            </p>
          </dd>
          <dt className="font-semibold">Lähetetty</dt>
          <dd>{new Date(submitted.submittedAt).toLocaleString("fi-FI")}</dd>
        </dl>
        <div className="border-t border-line px-5 py-5 sm:px-8">
          <Link href="/forms" className={secondaryButton}>
            Takaisin lomakkeisiin
          </Link>
        </div>
      </section>
    );
  }

  const fields = template.fields;

  if (template.status !== "PUBLISHED") {
    return (
      <>
        <PageHeader title={template.name} />
        <Notice>Lomaketta ei ole julkaistu, joten sitä ei voi täyttää.</Notice>
      </>
    );
  }

  function setValue(field: FormField, value: string) {
    setValues((current) => ({ ...current, [field.id]: value }));
    if (prefilledIds.has(field.id)) {
      setPrefilledIds((current) => {
        const next = new Set(current);
        next.delete(field.id);
        return next;
      });
    }
    // Clear a field's error as soon as the user changes it.
    if (errors[field.id]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field.id];
        return next;
      });
    }
  }

  function showErrors(next: FieldErrors, message?: string) {
    setErrors(next);
    setFormError(message);
    // Move focus to the summary so keyboard and screen reader users hear what went wrong.
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function showFailure(result: Extract<ApiResult<unknown>, { ok: false }>) {
    // Errors not tied to a visible field (e.g. the form changed meanwhile) go to the summary.
    const known = new Set(fields.map((field) => String(field.id)));
    const fieldErrors: FieldErrors = {};
    let message = result.formError;
    for (const [key, text] of Object.entries(result.fieldErrors)) {
      if (known.has(key)) fieldErrors[key] = text;
      else message = text;
    }
    if (result.status === 404) message = "Lomaketta ei löytynyt. Se on ehkä poistettu käytöstä.";
    showErrors(fieldErrors, message);
  }

  // Opening the summary only runs the client checks; it never sends answers anywhere.
  function handleReview(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setDraftNotice(undefined);
    const clientErrors = checkAnswers(fields, values);
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError(undefined);
    setConfirmed(false);
    setConfirmError(undefined);
    focusAfterStep.current = "review";
    setStep("review");
  }

  function handleEdit(field?: FormField) {
    // Without a specific field, start from the first one so focus is not lost.
    const target = field ?? fields[0];
    focusAfterStep.current = target ? fieldId(target) : undefined;
    setStep("edit");
  }

  // The checkbox is a UI safeguard only; the backend still validates and checks ownership.
  async function handleConfirmSubmit() {
    if (!confirmed) {
      setConfirmError("Vahvista ensin, että olet tarkistanut vastaukset.");
      document.getElementById("confirm-submit")?.focus();
      return;
    }
    setPending("submit");
    // A draft is submitted through its own record so it leaves the draft list.
    const result = draft ? await submitDraft(draft.id, values) : await submitForm(id, values);
    setPending(undefined);
    if (result.ok) {
      const { referenceCode, submittedAt } = result.data.submission;
      setSubmitted({ referenceCode: referenceCode!, submittedAt: submittedAt! });
      return;
    }
    // Server-side errors are shown on the form, where the answers can be fixed.
    setStep("edit");
    showFailure(result);
  }

  // Runs only from the user's explicit choice. Fields the user has already filled are kept,
  // so previous data never overwrites a value without the user noticing.
  async function handleUsePrevious() {
    setPrefill({ step: "loading", fieldCount: prefill?.step === "offered" ? prefill.fieldCount : 0 });
    const result = await getPreviousData(id);
    if (!result.ok) {
      setPrefill({ step: "failed" });
      return;
    }
    const known = new Set(fields.map((field) => field.id));
    const filled: Record<number, string> = {};
    let kept = 0;
    for (const answer of result.data.previousData.answers) {
      if (!known.has(answer.fieldId)) continue;
      if ((values[answer.fieldId] ?? "").trim()) kept++;
      else filled[answer.fieldId] = answer.value;
    }
    setValues((current) => ({ ...current, ...filled }));
    setPrefilledIds(new Set(Object.keys(filled).map(Number)));
    setPrefill({
      step: "accepted",
      filled: Object.keys(filled).length,
      kept,
      submittedAt: result.data.previousData.submittedAt,
    });
  }

  // Saving a draft skips the required-field check on purpose; incomplete forms can be saved.
  async function handleSaveDraft() {
    setPending("draft");
    setDraftNotice(undefined);
    const result = await saveDraft(id, draft?.id, values);
    setPending(undefined);
    if (!result.ok) {
      showFailure(result);
      return;
    }
    const saved: Submission = result.data.submission;
    setErrors({});
    setFormError(undefined);
    setDraft({ id: saved.id, updatedAt: saved.updatedAt });
    setDraftNotice(
      `Luonnos tallennettu klo ${formatTime(saved.updatedAt)}. Voit jatkaa myöhemmin Lomakkeet-sivun kohdasta Keskeneräiset luonnokset.`,
    );
    // Keep the draft in the URL so a reload continues the same draft.
    if (!draft) router.replace(`/forms/${id}?draft=${saved.id}`, { scroll: false });
  }

  const errorFields = fields.filter((field) => errors[field.id]);
  const hasErrors = errorFields.length > 0 || Boolean(formError);
  const answeredCount = fields.filter((field) => (values[field.id] ?? "").trim()).length;
  const requiredCount = fields.filter((field) => field.required).length;

  const header = (
    <PageHeader
      title={template.name}
      meta={
        draft && (
          <>
            <Badge tone="draft">Luonnos</Badge>
            <span className="text-[0.9375rem] text-ink-muted">
              Tallennettu {new Date(draft.updatedAt).toLocaleString("fi-FI")}. Ei vielä lähetetty.
            </span>
          </>
        )
      }
      lead={template.description && <p className="whitespace-pre-line">{template.description}</p>}
    />
  );

  if (step === "review") {
    return (
      <>
        {header}
        <section aria-labelledby="review-heading">
          <h2 ref={reviewRef} id="review-heading" tabIndex={-1} className={`${sectionHeading} outline-none`}>
            Tarkista vastauksesi
          </h2>
          <p className="mt-1 text-ink-muted">
            Lomaketta ei ole vielä lähetetty. Tarkista vastaukset ja korjaa tarvittaessa ennen lähettämistä.
          </p>

          <dl className={`mt-5 -mx-4 divide-y divide-line border-y border-line bg-surface sm:mx-0 sm:rounded-md sm:border-x`}>
            {fields.map((field, index) => {
              const answer = formatAnswer(field, values[field.id]);
              return (
                <div key={field.id} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-4 sm:px-6">
                  <dt className="flex gap-2 text-[0.9375rem] text-ink-muted">
                    <span aria-hidden="true" className="w-5 shrink-0 tabular-nums">
                      {index + 1}.
                    </span>
                    <span className="min-w-0">{field.label}</span>
                  </dt>
                  <dd className="col-start-1 mt-1 pl-7 text-lg whitespace-pre-line wrap-anywhere">
                    {answer ?? <span className="text-base text-ink-subtle italic">Ei annettu</span>}
                  </dd>
                  <dd className="col-start-2 row-span-2 row-start-1 -mt-1.5">
                    <button
                      type="button"
                      onClick={() => handleEdit(field)}
                      aria-label={`Muokkaa: ${field.label}`}
                      className={textButton}
                    >
                      Muokkaa
                    </button>
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-8 rounded-md border border-line-strong/60 bg-surface px-4 py-5 sm:px-6">
            <h3 className="font-bold">Vahvista ja lähetä</h3>
            <div className="mt-3 flex items-start gap-3">
              <input
                id="confirm-submit"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  if (e.target.checked) setConfirmError(undefined);
                }}
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={confirmError ? "confirm-submit-error" : undefined}
                className="mt-0.5 size-5 shrink-0 accent-brand"
              />
              <label htmlFor="confirm-submit">
                Olen tarkistanut vastaukseni ja haluan lähettää lomakkeen. Lähetettyä lomaketta ei voi enää
                muokata.
              </label>
            </div>
            {confirmError && <FieldError id="confirm-submit-error">{confirmError}</FieldError>}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={Boolean(pending)}
                className={`w-full sm:w-auto ${primaryButton}`}
              >
                {pending === "submit" ? "Lähetetään…" : "Lähetä lomake"}
              </button>
              <button
                type="button"
                onClick={() => handleEdit()}
                disabled={Boolean(pending)}
                className={`w-full sm:w-auto ${secondaryButton}`}
              >
                Muokkaa vastauksia
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {header}

      {prefill && (
        <PrefillNotice
          state={prefill}
          onAccept={handleUsePrevious}
          onDecline={() => setPrefill({ step: "declined" })}
        />
      )}

      {/* Always rendered so focus can move here; content appears only when there are errors. */}
      <div ref={summaryRef} tabIndex={-1} className="outline-none" aria-live="assertive">
        {hasErrors && (
          <div className="mb-6 rounded-md border border-danger/40 bg-danger-tint px-4 py-4 text-danger sm:px-5">
            {errorFields.length > 0 && (
              <>
                <p className="font-bold">
                  Tarkista {errorFields.length === 1 ? "yksi kohta" : `${errorFields.length} kohtaa`}:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errorFields.map((field) => (
                    <li key={field.id}>
                      <a href={`#${fieldId(field)}`} className="font-semibold underline underline-offset-4">
                        {field.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {formError && <p className={`font-semibold ${errorFields.length > 0 ? "mt-2" : ""}`}>{formError}</p>}
          </div>
        )}
      </div>

      {/* noValidate: errors are shown in one consistent style from the same rules as the backend. */}
      <form
        onSubmit={handleReview}
        noValidate
        className="-mx-4 border-y border-line bg-surface sm:mx-0 sm:rounded-md sm:border-x"
      >
        <p className="border-b border-line px-4 py-3 text-[0.9375rem] text-ink-muted sm:px-8">
          {fields.length} {fields.length === 1 ? "kysymys" : "kysymystä"}
          {requiredCount > 0 && (
            <>
              . Tähdellä (<span className="font-bold text-danger">*</span>) merkityt kentät ovat pakollisia.
            </>
          )}
        </p>
        <ol className="px-4 py-2 sm:px-8">
          {fields.map((field, index) => (
            <AnswerField
              key={field.id}
              field={field}
              number={index + 1}
              value={values[field.id] ?? ""}
              error={errors[field.id]}
              prefilled={prefilledIds.has(field.id)}
              onChange={(value) => setValue(field, value)}
            />
          ))}
        </ol>
        <div className="border-t border-line px-4 py-5 sm:px-8">
          <p className="text-[0.9375rem] text-ink-muted">
            Vastattu {answeredCount}/{fields.length} kysymykseen. Tarkistat vastaukset ennen lähettämistä.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button type="submit" disabled={Boolean(pending)} className={`w-full sm:w-auto ${primaryButton}`}>
              Jatka yhteenvetoon
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={Boolean(pending)}
              className={`w-full sm:w-auto ${secondaryButton}`}
            >
              {pending === "draft" ? "Tallennetaan…" : "Tallenna luonnos"}
            </button>
          </div>
          <p role="status" className="text-[0.9375rem] text-ink-muted empty:hidden mt-3">
            {draftNotice}
          </p>
        </div>
      </form>
    </>
  );
}

/** Readable answer for the summary, or undefined when nothing was given. */
function formatAnswer(field: FormField, value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (field.fieldType === "DATE") {
    // Parsed by hand so the shown day never shifts with the time zone.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) return `${Number(match[3])}.${Number(match[2])}.${match[1]}`;
  }
  // SELECT values are the option texts themselves, so they are already readable.
  return trimmed;
}

type PrefillNoticeProps = {
  state: PrefillState;
  onAccept: () => void;
  onDecline: () => void;
};

function PrefillNotice({ state, onAccept, onDecline }: PrefillNoticeProps) {
  if (state.step === "offered" || state.step === "loading") {
    const count = state.fieldCount;
    const busy = state.step === "loading";
    return (
      <Notice aria-labelledby="prefill-heading" className="mb-6">
        <h2 id="prefill-heading" className="font-bold">
          Voit käyttää aiempia tietojasi lomakkeen esitäyttöön.
        </h2>
        <p className="mt-1 max-w-[40rem] text-ink-muted">
          Tiedot tulevat vain omasta aiemmin lähettämästäsi samasta lomakkeesta
          {count ? ` (${count === 1 ? "1 vastaus" : `${count} vastausta`})` : ""}. Voit muokata tai
          poistaa jokaisen esitäytetyn arvon ennen lähettämistä. Aiempi lähetyksesi ei muutu. Jos
          täytät tyhjänä, aiempia tietoja ei käytetä ja lomake alkaa tyhjänä.
        </p>
        {/* Equal styling on purpose: neither choice is nudged. */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onAccept} disabled={busy} className={`w-full sm:w-auto ${secondaryButton}`}>
            {busy ? "Haetaan…" : "Käytä aiempia tietojani"}
          </button>
          <button type="button" onClick={onDecline} disabled={busy} className={`w-full sm:w-auto ${secondaryButton}`}>
            Täytä tyhjänä
          </button>
        </div>
      </Notice>
    );
  }

  let message: string;
  if (state.step === "declined") {
    message = "Aiempia tietoja ei käytetä. Lomake alkaa tyhjänä.";
  } else if (state.step === "failed") {
    message = "Aiempia tietoja ei voitu hakea. Voit täyttää lomakkeen tavallisesti.";
  } else {
    const source = state.submittedAt
      ? ` lomakkeesta, jonka lähetit ${new Date(state.submittedAt).toLocaleDateString("fi-FI")}`
      : "";
    message =
      state.filled > 0
        ? `Esitäytettiin ${state.filled === 1 ? "1 kenttä" : `${state.filled} kenttää`}${source}. Tarkista arvot ja muokkaa niitä tarvittaessa.`
        : "Esitäytettäviä tietoja ei ollut.";
    if (state.kept > 0) {
      message += ` ${state.kept === 1 ? "Yhtä kenttää" : `${state.kept} kenttää`} ei muutettu, koska olit jo täyttänyt ${state.kept === 1 ? "sen" : "ne"}.`;
    }
  }
  return (
    <p
      role="status"
      className={`mb-6 rounded-md border px-4 py-3 sm:px-5 ${
        state.step === "accepted" ? "border-brand/30 bg-brand-tint" : "border-line bg-surface"
      }`}
    >
      {message}
    </p>
  );
}

type AnswerFieldProps = {
  field: FormField;
  number: number;
  value: string;
  error?: string;
  prefilled: boolean;
  onChange: (value: string) => void;
};

// One question on the form's numbered spine. The node fills in once the question has an answer.
function AnswerField({ field, number, value, error, prefilled, onChange }: AnswerFieldProps) {
  const id = fieldId(field);
  const hintId = field.description ? `${id}-hint` : undefined;
  const prefilledId = prefilled ? `${id}-prefilled` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const help = useQuestionHelp(field);
  const helpId = `${id}-ai`;
  const answered = value.trim() !== "";
  const common = {
    id,
    name: id,
    value,
    "aria-required": field.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, help.state.step === "shown" ? helpId : undefined, prefilledId, errorId].filter(Boolean).join(" ") || undefined,
    className: `${inputClass} ${borderFor(error)}`,
  };

  let input;
  switch (field.fieldType) {
    case "NUMBER":
      // Text input keeps whatever was typed (also a decimal comma) so an error can point at it.
      input = (
        <input type="text" inputMode="decimal" {...common} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "DATE":
      input = <input type="date" {...common} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "SELECT":
      input = (
        <select {...common} className={`${selectClass} ${borderFor(error)}`} onChange={(e) => onChange(e.target.value)}>
          <option value="">Valitse…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    default:
      input = <input type="text" {...common} onChange={(e) => onChange(e.target.value)} />;
  }

  const node = error
    ? "border-danger bg-danger-tint text-danger"
    : answered
      ? "border-brand bg-brand text-white"
      : "border-line-strong bg-surface text-ink-muted";

  return (
    <li className="group/q relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-6 sm:gap-x-5">
      {/* The spine: joins the question nodes, starting and ending at the first and last node. */}
      <span
        aria-hidden="true"
        className="absolute top-0 bottom-0 left-4 w-px bg-line group-first/q:top-10 group-last/q:bottom-auto group-last/q:h-10 group-only/q:hidden"
      />
      <span
        aria-hidden="true"
        className={`relative flex size-8 items-center justify-center rounded-full border-[1.5px] text-sm font-bold tabular-nums transition-colors ${node}`}
      >
        {number}
      </span>
      <div className="pt-1">
        <label htmlFor={id} className={`${labelClass} text-[1.0625rem]`}>
          {field.label}
          {field.required && (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {field.description && (
          <p id={hintId} className={hintClass}>
            {field.description}
          </p>
        )}
        <QuestionHelp help={help} panelId={helpId} label={field.label} />
        {input}
        {prefilled && (
          <p id={prefilledId} className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-brand-tint px-2 py-0.5 text-sm font-semibold text-brand">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 4 6.5 11 3 7.5" />
            </svg>
            Esitäytetty aiemmista tiedoista
          </p>
        )}
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </li>
  );
}
