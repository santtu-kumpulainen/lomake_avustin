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
import { Badge, EmptyState, ErrorMessage, Loading, PageHeader, StatusBadge, TextField } from "@/components/ui/parts";
import { panel, primaryButton, secondaryButton, sectionHeading, smallButton } from "@/components/ui/styles";

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

  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (!template) return <Loading />;

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
      <PageHeader
        title={template.name}
        meta={<StatusBadge status={template.status} label={statusLabels[template.status]} />}
        lead={
          <p aria-live="polite" className="text-base">
            {isDraft
              ? "Luonnos ei näy käyttäjille. Muutokset tallentuvat luonnokseen, kunnes julkaiset lomakkeen."
              : "Julkaistu lomake näkyy käyttäjille. Palauta se luonnokseksi, jos haluat muokata sitä."}
          </p>
        }
        actions={
          isDraft ? (
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
          )
        }
      />

      {actionError && <ErrorMessage className="mb-8">{actionError}</ErrorMessage>}

      <div className="space-y-12">
        <section aria-labelledby="details-heading">
          <h2 id="details-heading" className={sectionHeading}>
            Perustiedot
          </h2>
          <div className={`mt-4 px-4 py-5 sm:px-6 ${panel}`}>
            {isDraft ? (
              // key resets the uncontrolled inputs after the saved values come back.
              <form key={template.updatedAt} onSubmit={handleDetails} noValidate className="space-y-5">
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
                <div className="flex flex-wrap items-center gap-4">
                  <button type="submit" className={secondaryButton}>
                    Tallenna luonnos
                  </button>
                  {detailsSaved && (
                    <p role="status" className="font-semibold text-brand">
                      Tallennettu.
                    </p>
                  )}
                </div>
              </form>
            ) : (
              <dl className="space-y-3">
                <div>
                  <dt className="text-[0.9375rem] text-ink-muted">Nimi</dt>
                  <dd className="font-semibold">{template.name}</dd>
                </div>
                <div>
                  <dt className="text-[0.9375rem] text-ink-muted">Kuvaus</dt>
                  <dd className="whitespace-pre-line">{template.description ?? "Ei kuvausta."}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <section aria-labelledby="fields-heading">
          <h2 id="fields-heading" className={sectionHeading}>
            Kentät
          </h2>
          <div className="mt-4">
            {fields.length === 0 ? (
              <EmptyState title="Kenttiä ei ole vielä.">Lisää vähintään yksi kenttä ennen julkaisua.</EmptyState>
            ) : (
              <ol className={`divide-y divide-line ${panel}`}>
                {fields.map((field, index) => (
                  <li key={field.id} className={`px-4 py-4 sm:px-6 ${editingFieldId === field.id ? "bg-canvas" : ""}`}>
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
          </div>
        </section>

        {isDraft && (
          <section aria-labelledby="add-field-heading">
            <h2 id="add-field-heading" className={sectionHeading}>
              Lisää kenttä
            </h2>
            <div className={`mt-4 px-4 py-5 sm:px-6 ${panel}`}>
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
          <section aria-labelledby="delete-heading" className="border-t border-line pt-6">
            <h2 id="delete-heading" className="font-bold">
              Poista lomakepohja
            </h2>
            <p className="mt-1 text-ink-muted">Pohja poistetaan kenttineen. Poistoa ei voi perua.</p>
            <button
              type="button"
              disabled={busy}
              onClick={handleDeleteTemplate}
              className={`mt-3 ${secondaryButton} border-danger/60 text-danger hover:border-danger hover:bg-danger-tint`}
            >
              Poista lomakepohja
            </button>
          </section>
        )}
      </div>
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
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-64 gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-strong text-sm font-bold tabular-nums text-ink-muted"
        >
          {number}
        </span>
        <div className="min-w-0">
          <p className="font-semibold wrap-break-word">
            {field.label}
            {field.required && (
              <span className="ml-1 text-danger" aria-hidden="true">
                *
              </span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap gap-2">
            <Badge>{fieldTypeLabels[field.fieldType]}</Badge>
            <Badge>{field.required ? "Pakollinen" : "Valinnainen"}</Badge>
          </p>
          {field.description && <p className="mt-2 text-[0.9375rem] text-ink-muted">{field.description}</p>}
          {field.options && (
            <p className="mt-1 text-[0.9375rem] text-ink-muted">Vaihtoehdot: {field.options.join(", ")}</p>
          )}
        </div>
      </div>
      {editable && (
        <div className="grid w-full grid-cols-4 gap-1.5 sm:flex sm:w-auto sm:gap-2 [&>button]:justify-center [&>button]:px-2 sm:[&>button]:px-3">
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
          <button type="button" onClick={onEdit} disabled={busy} aria-label={`Muokkaa: ${field.label}`} className={smallButton}>
            Muokkaa
          </button>
          <button type="button" onClick={onDelete} disabled={busy} aria-label={`Poista: ${field.label}`} className={smallButton}>
            Poista
          </button>
        </div>
      )}
    </div>
  );
}
