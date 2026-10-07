"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime, getSubmission, type Submission } from "@/lib/submissions";
import { AnswerList } from "@/components/forms/AnswerList";
import { Badge, ErrorMessage, Loading, Notice, PageHeader } from "@/components/ui/parts";
import { panel, sectionHeading, textLink } from "@/components/ui/styles";

/** Read-only view of the user's own submitted form. */
export function SubmissionDetail({ id }: { id: number }) {
  // undefined = still loading.
  const [submission, setSubmission] = useState<Submission>();
  const [status, setStatus] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getSubmission(id).then((result) => {
      if (result.ok) setSubmission(result.data.submission);
      else {
        setStatus(result.status);
        setError(result.formError);
      }
    });
  }, [id]);

  if (status === 401) {
    return (
      <Notice>
        Kirjaudu sisään nähdäksesi lähetyksen.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  // Another user's submission is a 404 too, so this says nothing about whether it exists.
  if (status === 404) return <ErrorMessage>Lähetystä ei löytynyt.</ErrorMessage>;
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!submission) return <Loading />;

  if (submission.status !== "SUBMITTED") {
    return (
      <>
        <PageHeader title={submission.formName} meta={<Badge tone="draft">Luonnos</Badge>} />
        <Notice>
          Tätä lomaketta ei ole vielä lähetetty, joten se ei ole lähetyksissäsi.{" "}
          {submission.formAvailable && (
            <Link href={`/forms/${submission.formTemplateId}?draft=${submission.id}`} className={textLink}>
              Jatka luonnoksen täyttämistä
            </Link>
          )}
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title={submission.formName} meta={<Badge tone="brand">Lähetetty</Badge>} />

      <dl className={`grid gap-x-8 gap-y-1 px-4 py-5 sm:grid-cols-[auto_1fr] sm:gap-y-4 sm:px-6 ${panel}`}>
        <dt className="font-semibold">Tila</dt>
        <dd>Lähetetty</dd>
        <dt className="mt-3 font-semibold sm:mt-0">Lähetetty</dt>
        <dd>{formatDateTime(submission.submittedAt!)}</dd>
        <dt className="mt-3 font-semibold sm:mt-0">Viitekoodi</dt>
        <dd>
          <span className="font-mono text-xl font-bold tracking-[0.03em]">{submission.referenceCode}</span>
          <p className="mt-1 text-[0.9375rem] text-ink-muted">
            Lähetettyä lomaketta ei voi muokata. Jos huomaat virheen, ota yhteyttä ja kerro viitekoodi.
          </p>
        </dd>
      </dl>

      <section aria-labelledby="answers-heading" className="mt-10">
        <h2 id="answers-heading" className={sectionHeading}>
          Vastaukset
        </h2>
        <div className="mt-4">
          <AnswerList items={submission.answers} />
        </div>
      </section>
    </>
  );
}
