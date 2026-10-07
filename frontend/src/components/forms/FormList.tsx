"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listTemplates, type TemplateSummary } from "@/lib/forms";
import { listDrafts, type DraftSummary } from "@/lib/submissions";
import { Badge, Chevron, EmptyState, ErrorMessage, Loading } from "@/components/ui/parts";
import { secondaryButton, sectionHeading, textLink } from "@/components/ui/styles";

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
      <p>
        Kirjaudu sisään nähdäksesi lomakkeet.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </p>
    );
  }
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!forms || !drafts) return <Loading />;

  return (
    <div className="space-y-12">
      {drafts.length > 0 && (
        <section aria-labelledby="drafts-heading">
          <h2 id="drafts-heading" className={sectionHeading}>
            Keskeneräiset luonnokset
          </h2>
          <p className="mt-1 text-ink-muted">Luonnoksia ei ole lähetetty. Jatka täyttämistä ja lähetä, kun olet valmis.</p>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-semibold wrap-break-word">{draft.formName}</p>
                    <Badge tone="draft">Luonnos</Badge>
                  </div>
                  <p className="mt-1 text-[0.9375rem] text-ink-muted">
                    Tallennettu {new Date(draft.updatedAt).toLocaleString("fi-FI")}.{" "}
                    {draft.answerCount} {draft.answerCount === 1 ? "vastaus" : "vastausta"}.
                  </p>
                  {!draft.formAvailable && (
                    <p className="mt-1 text-[0.9375rem] text-ink-muted">
                      Lomake ei ole tällä hetkellä käytettävissä. Luonnos säilyy, ja voit jatkaa, kun
                      lomake on taas saatavilla.
                    </p>
                  )}
                </div>
                {draft.formAvailable && (
                  <Link href={`/forms/${draft.formTemplateId}?draft=${draft.id}`} className={secondaryButton}>
                    Jatka täyttämistä<span className="sr-only">: {draft.formName}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="forms-heading">
        <h2 id="forms-heading" className={sectionHeading}>
          Täytettävät lomakkeet
        </h2>
        <div className="mt-4">
          {forms.length === 0 ? (
            <EmptyState title="Täytettäviä lomakkeita ei ole juuri nyt.">
              Lomakkeet tulevat näkyviin, kun ylläpitäjä julkaisee ne.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {forms.map((form) => (
                <li key={form.id}>
                  <Link
                    href={`/forms/${form.id}`}
                    className="group flex items-center justify-between gap-4 px-5 py-5 hover:bg-canvas sm:px-6"
                  >
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold text-brand wrap-break-word group-hover:underline group-hover:underline-offset-4">
                        {form.name}
                      </span>
                      {form.description && (
                        <span className="mt-1 block text-ink-muted">{form.description}</span>
                      )}
                      <span className="mt-1 block text-[0.9375rem] text-ink-subtle">
                        {form.fieldCount} {form.fieldCount === 1 ? "kysymys" : "kysymystä"}
                      </span>
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
