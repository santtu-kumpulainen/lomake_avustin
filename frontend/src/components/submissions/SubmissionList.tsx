"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime, listSubmissions, type SubmittedSummary } from "@/lib/submissions";
import { Badge, Chevron, EmptyState, ErrorMessage, Loading, Notice } from "@/components/ui/parts";
import { textLink } from "@/components/ui/styles";

export function SubmissionList() {
  // undefined = still loading.
  const [submissions, setSubmissions] = useState<SubmittedSummary[]>();
  const [status, setStatus] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listSubmissions().then((result) => {
      if (result.ok) setSubmissions(result.data.submissions);
      else {
        setStatus(result.status);
        setError(result.formError);
      }
    });
  }, []);

  if (status === 401) {
    return (
      <Notice>
        Kirjaudu sisään nähdäksesi lähetyksesi.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!submissions) return <Loading />;

  if (submissions.length === 0) {
    return (
      <EmptyState title="Et ole vielä lähettänyt lomakkeita.">
        Lähettämäsi lomakkeet näkyvät tässä viitekoodin kanssa.{" "}
        <Link href="/forms" className={textLink}>
          Siirry lomakkeisiin
        </Link>
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {submissions.map((submission) => (
        <li key={submission.id}>
          <Link
            href={`/submissions/${submission.id}`}
            className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-canvas sm:px-6"
          >
            <span className="min-w-0">
              <span className="block text-lg font-semibold text-brand wrap-break-word group-hover:underline group-hover:underline-offset-4">
                {submission.formName}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.9375rem] text-ink-muted">
                {/* Status is written out, not shown by color alone. */}
                <Badge tone="brand">Lähetetty</Badge>
                <span>{formatDateTime(submission.submittedAt)}</span>
                <span>
                  Viitekoodi <span className="font-mono font-bold tracking-[0.03em] text-ink">{submission.referenceCode}</span>
                </span>
              </span>
            </span>
            <Chevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}
