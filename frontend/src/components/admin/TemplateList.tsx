"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type SubmitEvent } from "react";
import {
  createTemplate,
  listTemplates,
  statusLabels,
  type FieldErrors,
  type TemplateSummary,
} from "@/lib/forms";
import { ErrorMessage, StatusBadge, TextField } from "./parts";
import { primaryButton, sectionHeading } from "./styles";

export function TemplateList() {
  const router = useRouter();
  // undefined = still loading.
  const [templates, setTemplates] = useState<TemplateSummary[]>();
  const [loadError, setLoadError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    listTemplates().then((result) => {
      if (result.ok) setTemplates(result.data.templates);
      else setLoadError(result.formError);
    });
  }, []);

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFieldErrors({});
    setFormError(undefined);

    const result = await createTemplate({
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? "") || null,
    });
    if (result.ok) {
      router.push(`/admin/forms/${result.data.template.id}`);
      return;
    }
    setFieldErrors(result.fieldErrors);
    setFormError(result.formError);
    setPending(false);
  }

  return (
    <>
      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className={sectionHeading}>Lomakepohjat</h2>
        {loadError && <ErrorMessage className="mt-4">{loadError}</ErrorMessage>}
        {templates === undefined && !loadError && (
          <p className="mt-4 text-sm text-neutral-500">Ladataan…</p>
        )}
        {templates?.length === 0 && (
          <p className="mt-4 text-sm text-neutral-600">Lomakepohjia ei ole vielä luotu.</p>
        )}
        {templates && templates.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-500">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Nimi</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tila</th>
                <th scope="col" className="py-2 text-right font-medium">Kenttiä</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b border-neutral-100">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/forms/${template.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {template.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={template.status} label={statusLabels[template.status]} />
                  </td>
                  <td className="py-3 text-right tabular-nums">{template.fieldCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className={sectionHeading}>Uusi lomakepohja</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Uusi pohja tallennetaan luonnoksena. Kentät lisätään seuraavassa vaiheessa.
        </p>
        <form onSubmit={handleCreate} noValidate className="mt-6 space-y-5">
          {formError && <ErrorMessage>{formError}</ErrorMessage>}
          <TextField name="name" label="Nimi" error={fieldErrors.name} />
          <TextField
            name="description"
            label="Kuvaus"
            optional
            multiline
            error={fieldErrors.description}
          />
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Luodaan…" : "Luo luonnos"}
          </button>
        </form>
      </section>
    </>
  );
}
