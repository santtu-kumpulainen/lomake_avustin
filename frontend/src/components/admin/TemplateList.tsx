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
import { EmptyState, ErrorMessage, Loading, StatusBadge, TextField } from "@/components/ui/parts";
import { panel, primaryButton, sectionHeading, textLink } from "@/components/ui/styles";

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
      category: String(data.get("category") ?? "") || null,
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
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading" className={sectionHeading}>
          Kaikki lomakepohjat
        </h2>
        <div className="mt-4">
          {loadError && <ErrorMessage>{loadError}</ErrorMessage>}
          {templates === undefined && !loadError && <Loading />}
          {templates?.length === 0 && (
            <EmptyState title="Lomakepohjia ei ole vielä luotu.">Luo ensimmäinen pohja lomakkeella.</EmptyState>
          )}
          {templates && templates.length > 0 && (
            <div className={`overflow-hidden ${panel}`}>
              <table className="w-full text-left">
                <thead className="border-b border-line bg-canvas text-[0.9375rem] text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">Nimi</th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">Tila</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold sm:px-5">Kenttiä</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {templates.map((template) => (
                    <tr key={template.id} className="align-top">
                      <td className="px-4 py-3.5 sm:px-5">
                        <Link href={`/admin/forms/${template.id}`} className={`${textLink} wrap-anywhere`}>
                          {template.name}
                        </Link>
                        {template.category && (
                          <span className="mt-0.5 block text-[0.9375rem] text-ink-muted">{template.category}</span>
                        )}
                      </td>
                      <td className="px-2 py-3.5">
                        <StatusBadge status={template.status} label={statusLabels[template.status]} />
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums sm:px-5">{template.fieldCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="new-template-heading" className="lg:pt-0">
        <h2 id="new-template-heading" className={sectionHeading}>
          Uusi lomakepohja
        </h2>
        <p className="mt-1 text-ink-muted">Pohja tallennetaan luonnoksena. Kentät lisätään seuraavaksi.</p>
        <form onSubmit={handleCreate} noValidate className={`mt-4 space-y-5 px-4 py-5 sm:px-5 ${panel}`}>
          {formError && <ErrorMessage>{formError}</ErrorMessage>}
          <TextField name="name" label="Nimi" error={fieldErrors.name} />
          <TextField
            name="description"
            label="Kuvaus"
            optional
            multiline
            error={fieldErrors.description}
          />
          <TextField name="category" label="Aihe" optional error={fieldErrors.category} />
          <button type="submit" disabled={pending} className={`w-full ${primaryButton}`}>
            {pending ? "Luodaan…" : "Luo luonnos"}
          </button>
        </form>
      </section>
    </div>
  );
}
