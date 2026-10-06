"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type SubmitEvent } from "react";
import {
  addField,
  deleteField,
  deleteTemplate,
  fieldTypeLabels,
  getTemplate,
  publishTemplate,
  reorderFields,
  statusLabels,
  unpublishTemplate,
  updateField,
  updateTemplate,
  type ApiResult,
  type FieldErrors,
  type FieldInput,
  type FormField,
  type FormTemplate,
} from "@/lib/forms";
import { FieldForm } from "./FieldForm";
import { ErrorMessage, StatusBadge, TextField } from "./parts";
import { primaryButton, secondaryButton, sectionHeading, smallButton } from "./styles";

type TemplateResult = ApiResult<{ template: FormTemplate }>;

export function TemplateEditor({ id }: { id: number }) {
  const router = useRouter();
  // undefined = still loading.
  const [template, setTemplate] = useState<FormTemplate>();
  const [loadError, setLoadError] = useState<string>();
  // Errors from list actions (publish, reorder, delete) shown at the top of the page.
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<number>();
  const [detailErrors, setDetailErrors] = useState<FieldErrors>({});
  const [detailsSaved, setDetailsSaved] = useState(false);

  useEffect(() => {
    getTemplate(id).then((result) => {
      if (result.ok) setTemplate(result.data.template);
      else setLoadError(result.formError);
    });
  }, [id]);

  // Applies a result that returns the whole template; returns the error for forms to display.
  function apply(result: TemplateResult) {
    if (result.ok) {
      setTemplate(result.data.template);
      setActionError(undefined);
      return null;
    }
    return { fieldErrors: result.fieldErrors, formError: result.formError };
  }

  async function runAction(action: () => Promise<TemplateResult>) {
    setBusy(true);
    setActionError(undefined);
    const error = apply(await action());
    if (error) setActionError(error.formError ?? Object.values(error.fieldErrors)[0]);
    setBusy(false);
  }

  if (loadError) return <ErrorMessage className="mt-8">{loadError}</ErrorMessage>;
  if (!template) return <p className="mt-8 text-sm text-neutral-500">Ladataan…</p>;

  const isDraft = template.status === "DRAFT";
  const fields = template.fields;

  async function handleDetails(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setDetailErrors({});
    setDetailsSaved(false);
    const error = apply(
      await updateTemplate(id, {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? "") || null,
      }),
    );
    if (error) {
      setDetailErrors({ ...error.fieldErrors, ...(error.formError ? { form: error.formError } : {}) });
    } else {
      setDetailsSaved(true);
    }
  }

  function move(index: number, offset: -1 | 1) {
    const ids = fields.map((field) => field.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    return runAction(() => reorderFields(id, ids));
  }

  async function handleDeleteField(field: FormField) {
    if (!window.confirm(`Poistetaanko kenttä "${field.label}"?`)) return;
    await runAction(() => deleteField(id, field.id));
  }

  async function handleDeleteTemplate() {
    if (!window.confirm(`Poistetaanko lomakepohja "${template!.name}" kenttineen?`)) return;
    setBusy(true);
    setActionError(undefined);
    const result = await deleteTemplate(id);
    if (result.ok) {
      router.push("/admin/forms");
      return;
    }
    setActionError(result.formError);
    setBusy(false);
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{template.name}</h1>
          <div className="mt-3">
            <StatusBadge status={template.status} label={statusLabels[template.status]} />
          </div>
        </div>
        {isDraft ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => runAction(() => publishTemplate(id))}
            className={primaryButton}
          >
            Julkaise
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => runAction(() => unpublishTemplate(id))}
            className={secondaryButton}
          >
            Palauta luonnokseksi
          </button>
        )}
      </div>

      <p className="mt-4 text-sm text-neutral-600" aria-live="polite">
        {isDraft
          ? "Luonnos ei näy käyttäjille. Muutokset tallentuvat luonnokseen, kunnes julkaiset lomakkeen."
          : "Julkaistu lomake näkyy käyttäjille. Palauta se luonnokseksi, jos haluat muokata sitä."}
      </p>

      {actionError && <ErrorMessage className="mt-6">{actionError}</ErrorMessage>}

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className={sectionHeading}>Perustiedot</h2>
        {isDraft ? (
          // key resets the uncontrolled inputs after the saved values come back.
          <form key={template.updatedAt} onSubmit={handleDetails} noValidate className="mt-6 space-y-5">
            {detailErrors.form && <ErrorMessage>{detailErrors.form}</ErrorMessage>}
            <TextField name="name" label="Nimi" defaultValue={template.name} error={detailErrors.name} />
            <TextField
              name="description"
              label="Kuvaus"
              optional
              multiline
              defaultValue={template.description}
              error={detailErrors.description}
            />
            <div className="flex items-center gap-4">
              <button type="submit" className={secondaryButton}>
                Tallenna luonnos
              </button>
              {detailsSaved && (
                <p role="status" className="text-sm text-neutral-600">
                  Tallennettu.
                </p>
              )}
            </div>
          </form>
        ) : (
          <p className="mt-4 whitespace-pre-line text-sm text-neutral-700">
            {template.description ?? "Ei kuvausta."}
          </p>
        )}
      </section>

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className={sectionHeading}>Kentät</h2>
        {fields.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">
            Kenttiä ei ole vielä. Lisää vähintään yksi kenttä ennen julkaisua.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
            {fields.map((field, index) => (
              <li key={field.id} className="py-4">
                {editingFieldId === field.id ? (
                  <FieldForm
                    idPrefix={`edit-${field.id}-`}
                    field={field}
                    submitLabel="Tallenna kenttä"
                    pendingLabel="Tallennetaan…"
                    onSubmit={async (input: FieldInput) => {
                      const error = apply(await updateField(id, field.id, input));
                      if (!error) setEditingFieldId(undefined);
                      return error;
                    }}
                    onCancel={() => setEditingFieldId(undefined)}
                  />
                ) : (
                  <FieldRow
                    field={field}
                    number={index + 1}
                    editable={isDraft}
                    busy={busy}
                    isFirst={index === 0}
                    isLast={index === fields.length - 1}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                    onEdit={() => setEditingFieldId(field.id)}
                    onDelete={() => handleDeleteField(field)}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {isDraft && (
        <section className="mt-10 border-t border-neutral-200 pt-6">
          <h2 className={sectionHeading}>Lisää kenttä</h2>
          <div className="mt-6">
            <FieldForm
              idPrefix="new-"
              submitLabel="Lisää kenttä"
              pendingLabel="Lisätään…"
              onSubmit={async (input) => apply(await addField(id, input))}
            />
          </div>
        </section>
      )}

      {isDraft && (
        <section className="mt-16 border-t border-neutral-200 pt-6">
          <button
            type="button"
            disabled={busy}
            onClick={handleDeleteTemplate}
            className="text-sm font-medium text-red-800 underline underline-offset-4 hover:text-red-950 disabled:opacity-60"
          >
            Poista lomakepohja
          </button>
        </section>
      )}
    </>
  );
}

type FieldRowProps = {
  field: FormField;
  number: number;
  editable: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function FieldRow({
  field,
  number,
  editable,
  busy,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: FieldRowProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex gap-3">
        <span className="w-6 shrink-0 text-sm tabular-nums text-neutral-500">{number}.</span>
        <div>
          <p className="font-medium">
            {field.label}
            {field.required && (
              <span className="ml-1 text-red-800" aria-hidden="true">
                *
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-neutral-600">
            {fieldTypeLabels[field.fieldType]} · {field.required ? "Pakollinen" : "Valinnainen"}
          </p>
          {field.description && <p className="mt-1 text-sm text-neutral-500">{field.description}</p>}
          {field.options && (
            <p className="mt-1 text-sm text-neutral-500">Vaihtoehdot: {field.options.join(", ")}</p>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={busy || isFirst}
            aria-label={`Siirrä kenttä "${field.label}" ylös`}
            className={smallButton}
          >
            Ylös
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={busy || isLast}
            aria-label={`Siirrä kenttä "${field.label}" alas`}
            className={smallButton}
          >
            Alas
          </button>
          <button type="button" onClick={onEdit} disabled={busy} className={smallButton}>
            Muokkaa
          </button>
          <button type="button" onClick={onDelete} disabled={busy} className={smallButton}>
            Poista
          </button>
        </div>
      )}
    </div>
  );
}
