"use client";

import { useState, type SubmitEvent } from "react";
import {
  fieldTypeLabels,
  type FieldErrors,
  type FieldInput,
  type FieldType,
  type FormField,
} from "@/lib/forms";
import { ErrorMessage, FieldError, TextField } from "@/components/ui/parts";
import { borderFor, hintClass, labelClass, primaryButton, secondaryButton, selectClass, inputClass } from "@/components/ui/styles";

type Props = {
  idPrefix: string;
  field?: FormField;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (input: FieldInput) => Promise<{ fieldErrors: FieldErrors; formError?: string } | null>;
  onCancel?: () => void;
};

const fieldTypes = Object.keys(fieldTypeLabels) as FieldType[];

// Used both to add a new field and to edit an existing one.
export function FieldForm({ idPrefix, field, submitLabel, pendingLabel, onSubmit, onCancel }: Props) {
  // Controlled only to show or hide the options input.
  const [fieldType, setFieldType] = useState<FieldType>(field?.fieldType ?? "TEXT");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setFieldErrors({});
    setFormError(undefined);

    // One option per line; blank lines are ignored.
    const options =
      fieldType === "SELECT"
        ? String(data.get("options") ?? "")
            .split("\n")
            .map((option) => option.trim())
            .filter(Boolean)
        : null;

    const error = await onSubmit({
      label: String(data.get("label") ?? ""),
      description: String(data.get("description") ?? "") || null,
      fieldType,
      required: data.get("required") === "on",
      options,
    });
    setPending(false);
    if (error) {
      setFieldErrors(error.fieldErrors);
      setFormError(error.formError);
    } else if (!field) {
      form.reset();
      setFieldType("TEXT");
    }
  }

  const typeId = `${idPrefix}fieldType`;
  const optionsId = `${idPrefix}options`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <ErrorMessage>{formError}</ErrorMessage>}
      <TextField
        idPrefix={idPrefix}
        name="label"
        label="Kysymys"
        defaultValue={field?.label}
        error={fieldErrors.label}
      />
      <TextField
        idPrefix={idPrefix}
        name="description"
        label="Ohjeteksti"
        optional
        defaultValue={field?.description}
        error={fieldErrors.description}
      />

      <div>
        <label htmlFor={typeId} className={labelClass}>
          Kentän tyyppi
        </label>
        <select
          id={typeId}
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value as FieldType)}
          aria-invalid={fieldErrors.fieldType ? true : undefined}
          className={`${selectClass} ${borderFor(fieldErrors.fieldType)}`}
        >
          {fieldTypes.map((type) => (
            <option key={type} value={type}>
              {fieldTypeLabels[type]}
            </option>
          ))}
        </select>
        {fieldErrors.fieldType && <FieldError>{fieldErrors.fieldType}</FieldError>}
      </div>

      {fieldType === "SELECT" && (
        <div>
          <label htmlFor={optionsId} className={labelClass}>
            Vaihtoehdot
          </label>
          <p id={`${optionsId}-hint`} className={hintClass}>
            Yksi vaihtoehto per rivi.
          </p>
          <textarea
            id={optionsId}
            name="options"
            rows={4}
            defaultValue={field?.options?.join("\n") ?? ""}
            aria-invalid={fieldErrors.options ? true : undefined}
            aria-describedby={`${optionsId}-hint${fieldErrors.options ? ` ${optionsId}-error` : ""}`}
            className={`${inputClass} ${borderFor(fieldErrors.options)}`}
          />
          {fieldErrors.options && <FieldError id={`${optionsId}-error`}>{fieldErrors.options}</FieldError>}
        </div>
      )}

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name="required"
          defaultChecked={field?.required ?? false}
          className="size-5 accent-brand"
        />
        Pakollinen kenttä
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Peruuta
          </button>
        )}
      </div>
    </form>
  );
}
