"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { getTemplate, type FieldErrors, type FormField, type FormTemplate } from "@/lib/forms";
import { checkAnswers, submitForm, type SubmittedForm } from "@/lib/submissions";
import { ErrorMessage } from "@/components/admin/parts";
import { borderFor, inputClass, primaryButton } from "@/components/admin/styles";

const fieldId = (field: FormField) => `field-${field.id}`;

export function FormFiller({ id }: { id: number }) {
  // undefined = still loading.
  const [template, setTemplate] = useState<FormTemplate>();
  const [loadError, setLoadError] = useState<string>();
  // Answers live in state, so nothing the user typed is lost when validation fails.
  const [values, setValues] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedForm>();
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    getTemplate(id).then((result) => {
      if (result.ok) setTemplate(result.data.template);
      else setLoadError(result.formError);
    });
  }, [id]);

  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  if (loadError) return <ErrorMessage className="mt-8">{loadError}</ErrorMessage>;
  if (!template) return <p className="mt-8 text-sm text-neutral-500">Ladataan…</p>;

  if (submitted) {
    return (
      <section className="mt-6">
        <h1 ref={successRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">
          Lomake lähetetty
        </h1>
        <p className="mt-2 text-neutral-600">{template.name}</p>
        <div className="mt-8 border-l-2 border-emerald-700 pl-4">
          <p className="text-sm text-neutral-600">Viitekoodi</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-wider">{submitted.referenceCode}</p>
          <p className="mt-3 text-sm text-neutral-600">
            Lähetetty {new Date(submitted.submittedAt).toLocaleString("fi-FI")}. Säilytä viitekoodi; sillä
            lomakkeesi löytyy, jos otat yhteyttä.
          </p>
        </div>
        <Link href="/forms" className="mt-10 inline-block text-sm font-medium underline underline-offset-4">
          Takaisin lomakkeisiin
        </Link>
      </section>
    );
  }

  const fields = template.fields;

  if (template.status !== "PUBLISHED") {
    return (
      <>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{template.name}</h1>
        <p className="mt-4 text-sm">Lomaketta ei ole julkaistu, joten sitä ei voi täyttää.</p>
      </>
    );
  }

  function setValue(field: FormField, value: string) {
    setValues((current) => ({ ...current, [field.id]: value }));
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

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientErrors = checkAnswers(fields, values);
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors);
      return;
    }

    setPending(true);
    const result = await submitForm(id, values);
    setPending(false);
    if (result.ok) {
      setSubmitted(result.data.submission);
      return;
    }
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

  const errorFields = fields.filter((field) => errors[field.id]);
  const hasErrors = errorFields.length > 0 || Boolean(formError);

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{template.name}</h1>
      {template.description && (
        <p className="mt-2 whitespace-pre-line text-neutral-600">{template.description}</p>
      )}
      <p className="mt-6 text-sm text-neutral-600">
        Tähdellä (<span className="text-red-800">*</span>) merkityt kentät ovat pakollisia.
      </p>

      {/* Always rendered so focus can move here; content appears only when there are errors. */}
      <div ref={summaryRef} tabIndex={-1} className="outline-none" aria-live="assertive">
        {hasErrors && (
          <div className="mt-6 border-l-2 border-red-700 pl-4 text-sm text-red-800">
            {errorFields.length > 0 && (
              <>
                <p className="font-medium">
                  Tarkista {errorFields.length === 1 ? "yksi kohta" : `${errorFields.length} kohtaa`}:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errorFields.map((field) => (
                    <li key={field.id}>
                      <a href={`#${fieldId(field)}`} className="underline underline-offset-4">
                        {field.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {formError && <p className={errorFields.length > 0 ? "mt-2" : ""}>{formError}</p>}
          </div>
        )}
      </div>

      {/* noValidate: errors are shown in one consistent style from the same rules as the backend. */}
      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
        {fields.map((field) => (
          <AnswerField
            key={field.id}
            field={field}
            value={values[field.id] ?? ""}
            error={errors[field.id]}
            onChange={(value) => setValue(field, value)}
          />
        ))}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Lähetetään…" : "Lähetä lomake"}
        </button>
      </form>
    </>
  );
}

type AnswerFieldProps = {
  field: FormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
};

function AnswerField({ field, value, error, onChange }: AnswerFieldProps) {
  const id = fieldId(field);
  const hintId = field.description ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const common = {
    id,
    name: id,
    value,
    "aria-required": field.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
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
        <select {...common} onChange={(e) => onChange(e.target.value)}>
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

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}
        {field.required && (
          <span className="ml-1 text-red-800" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {field.description && (
        <p id={hintId} className="mt-1 text-sm text-neutral-500">
          {field.description}
        </p>
      )}
      {input}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
