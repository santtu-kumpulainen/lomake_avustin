"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listTemplates, type TemplateSummary } from "@/lib/forms";
import { listDrafts, type DraftSummary } from "@/lib/submissions";
import { ErrorMessage } from "@/components/admin/parts";
import { sectionHeading } from "@/components/admin/styles";

export function FormList() {
  // undefined = still loading.
  const [forms, setForms] = useState<TemplateSummary[]>();
  const [drafts, setDrafts] = useState<DraftSummary[]>();
  const [status, setStatus] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([listTemplates(), listDrafts()]).then(([formsResult, draftsResult]) => {
      if (!formsResult.ok) {
        setStatus(formsResult.status);
        setError(formsResult.formError);
        return;
      }
      // ADMIN also receives drafts from this endpoint; only published forms can be filled.
      setForms(formsResult.data.templates.filter((t) => t.status === "PUBLISHED"));
      setDrafts(draftsResult.ok ? draftsResult.data.drafts : []);
    });
  }, []);

  if (status === 401) {
    return (
      <p className="text-sm">
        Kirjaudu sisään nähdäksesi lomakkeet.{" "}
        <Link href="/login" className="font-medium underline underline-offset-4">
          Kirjaudu sisään
        </Link>
      </p>
    );
  }
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!forms || !drafts) return <p className="text-sm text-neutral-500">Ladataan…</p>;

  return (
    <>
      {drafts.length > 0 && (
        <section className="mb-12">
          <h2 className={sectionHeading}>Keskeneräiset luonnokset</h2>
          <p className="mt-2 text-sm text-neutral-600">Luonnoksia ei ole lähetetty. Jatka täyttämistä ja lähetä, kun olet valmis.</p>
          <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{draft.formName}</p>
                  <p className="mt-1 text-sm text-neutral-600">
                    Tallennettu {new Date(draft.updatedAt).toLocaleString("fi-FI")} ·{" "}
                    {draft.answerCount} {draft.answerCount === 1 ? "vastaus" : "vastausta"}
                  </p>
                  {!draft.formAvailable && (
                    <p className="mt-1 text-sm text-neutral-600">
                      Lomake ei ole tällä hetkellä käytettävissä. Luonnos säilyy, ja voit jatkaa, kun
                      lomake on taas saatavilla.
                    </p>
                  )}
                </div>
                {draft.formAvailable && (
                  <Link
                    href={`/forms/${draft.formTemplateId}?draft=${draft.id}`}
                    className="text-sm font-medium underline underline-offset-4"
                  >
                    Jatka täyttämistä<span className="sr-only">: {draft.formName}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className={sectionHeading}>Täytettävät lomakkeet</h2>
        {forms.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">Täytettäviä lomakkeita ei ole juuri nyt.</p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
            {forms.map((form) => (
              <li key={form.id}>
                <Link
                  href={`/forms/${form.id}`}
                  className="group block py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  <span className="font-medium underline-offset-4 group-hover:underline">{form.name}</span>
                  {form.description && (
                    <span className="mt-1 block text-sm text-neutral-600">{form.description}</span>
                  )}
                  <span className="mt-1 block text-sm text-neutral-500">
                    {form.fieldCount} {form.fieldCount === 1 ? "kysymys" : "kysymystä"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
