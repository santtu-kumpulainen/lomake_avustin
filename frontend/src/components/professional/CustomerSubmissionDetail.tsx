"use client";

import { useEffect, useState } from "react";
import { customerName, getCustomer, getCustomerSubmission, type CustomerSubmission } from "@/lib/professional";
import { formatDateTime } from "@/lib/submissions";
import { AnswerList } from "@/components/forms/AnswerList";
import { Badge, Loading, PageHeader } from "@/components/ui/parts";
import { panel, sectionHeading } from "@/components/ui/styles";
import { CustomerAccessState } from "./CustomerAccessState";

/** Read-only submitted form of an assigned customer. Drafts are never returned by the backend. */
export function CustomerSubmissionDetail({ customerId, submissionId }: { customerId: number; submissionId: number }) {
  // undefined = still loading.
  const [submission, setSubmission] = useState<CustomerSubmission>();
  const [name, setName] = useState<string>();
  const [failure, setFailure] = useState<{ status: number; error?: string }>();

  useEffect(() => {
    getCustomerSubmission(customerId, submissionId).then((result) => {
      if (result.ok) setSubmission(result.data.submission);
      else setFailure({ status: result.status, error: result.formError });
    });
    getCustomer(customerId).then((result) => {
      if (result.ok) setName(customerName(result.data.customer));
    });
  }, [customerId, submissionId]);

  if (failure) return <CustomerAccessState status={failure.status} error={failure.error} />;
  if (!submission) return <Loading />;

  return (
    <>
      <PageHeader
        title={submission.formName}
        meta={
          <>
            <Badge tone="brand">Lähetetty</Badge>
            {name && <span className="text-ink-muted">Asiakas: {name}</span>}
          </>
        }
      />

      <dl className={`grid gap-x-8 gap-y-1 px-4 py-5 sm:grid-cols-[auto_1fr] sm:gap-y-4 sm:px-6 ${panel}`}>
        <dt className="font-semibold">Lähetetty</dt>
        <dd>{formatDateTime(submission.submittedAt)}</dd>
        <dt className="mt-3 font-semibold sm:mt-0">Viitekoodi</dt>
        <dd className="font-mono text-xl font-bold tracking-[0.03em]">{submission.referenceCode}</dd>
      </dl>

      <section aria-labelledby="answers-heading" className="mt-10">
        <h2 id="answers-heading" className={sectionHeading}>
          Vastaukset
        </h2>
        <p className="mt-1 text-ink-muted">Tyhjäksi jätetyt kysymykset on merkitty.</p>
        <div className="mt-4">
          <AnswerList items={submission.answers} />
        </div>
      </section>
    </>
  );
}
