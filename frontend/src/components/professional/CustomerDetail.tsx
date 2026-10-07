"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  customerName,
  formatDate,
  getCustomer,
  getCustomerDescriptions,
  getCustomerSubmissions,
  type CustomerDescription,
  type CustomerProfile,
} from "@/lib/professional";
import { formatDateTime, type SubmittedSummary } from "@/lib/submissions";
import { Badge, Chevron, EmptyState, ErrorMessage, Loading, PageHeader } from "@/components/ui/parts";
import { panel, sectionHeading } from "@/components/ui/styles";
import { CustomerAccessState } from "./CustomerAccessState";

type Failure = { status: number; error?: string };

/** Read-only view of one assigned customer. Shows stored data only, with no interpretation. */
export function CustomerDetail({ id }: { id: number }) {
  // undefined = still loading.
  const [customer, setCustomer] = useState<CustomerProfile>();
  const [descriptions, setDescriptions] = useState<CustomerDescription[]>();
  const [submissions, setSubmissions] = useState<SubmittedSummary[]>();
  const [failure, setFailure] = useState<Failure>();
  const [partError, setPartError] = useState(false);

  useEffect(() => {
    // The profile request decides access; the sections load only once it succeeds.
    getCustomer(id).then((result) => {
      if (!result.ok) {
        setFailure({ status: result.status, error: result.formError });
        return;
      }
      setCustomer(result.data.customer);
      getCustomerDescriptions(id).then((r) => (r.ok ? setDescriptions(r.data.symptomDescriptions) : setPartError(true)));
      getCustomerSubmissions(id).then((r) => (r.ok ? setSubmissions(r.data.submissions) : setPartError(true)));
    });
  }, [id]);

  if (failure) return <CustomerAccessState status={failure.status} error={failure.error} />;
  if (!customer) return <Loading>Ladataan asiakkaan tietoja…</Loading>;

  const notGiven = <span className="text-ink-subtle italic">Ei annettu</span>;

  return (
    <>
      <PageHeader title={customerName(customer)} meta={<Badge>Vain luku</Badge>} />

      {partError && (
        <ErrorMessage className="mb-6">Osaa tiedoista ei voitu hakea. Lataa sivu uudelleen.</ErrorMessage>
      )}

      <div className="space-y-10">
        <section aria-labelledby="profile-heading">
          <h2 id="profile-heading" className={sectionHeading}>
            Perustiedot
          </h2>
          <dl className={`mt-4 grid gap-x-8 gap-y-1 px-4 py-5 sm:grid-cols-[auto_1fr] sm:gap-y-4 sm:px-6 ${panel}`}>
            <dt className="font-semibold">Etunimi</dt>
            <dd className="wrap-break-word">{customer.firstName ?? notGiven}</dd>
            <dt className="mt-3 font-semibold sm:mt-0">Sukunimi</dt>
            <dd className="wrap-break-word">{customer.lastName ?? notGiven}</dd>
            <dt className="mt-3 font-semibold sm:mt-0">Syntymäaika</dt>
            <dd>{customer.dateOfBirth ? formatDate(customer.dateOfBirth) : notGiven}</dd>
            <dt className="mt-3 font-semibold sm:mt-0">Puhelin</dt>
            <dd>{customer.phone ?? notGiven}</dd>
          </dl>
        </section>

        <section aria-labelledby="reasons-heading">
          <h2 id="reasons-heading" className={sectionHeading}>
            Miksi asiakas hakee apua
          </h2>
          <p className="mt-1 text-ink-muted">Asiakkaan omin sanoin kirjoittamat kuvaukset, uusin ensin.</p>
          <div className="mt-4">
            {descriptions === undefined ? (
              !partError && <Loading />
            ) : descriptions.length === 0 ? (
              <EmptyState title="Asiakas ei ole kirjoittanut kuvauksia." />
            ) : (
              <ol className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
                {descriptions.map((item, index) => (
                  <li key={`${item.createdAt}-${index}`} className="px-5 py-4 sm:px-6">
                    <p className="text-[0.9375rem] text-ink-muted">
                      <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    </p>
                    <p className="mt-1 whitespace-pre-line wrap-break-word">{item.description}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section aria-labelledby="submissions-heading">
          <h2 id="submissions-heading" className={sectionHeading}>
            Lähetetyt lomakkeet
          </h2>
          <div className="mt-4">
            {submissions === undefined ? (
              !partError && <Loading />
            ) : submissions.length === 0 ? (
              <EmptyState title="Asiakas ei ole lähettänyt lomakkeita." />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
                {submissions.map((submission) => (
                  <li key={submission.id}>
                    <Link
                      href={`/professional/customers/${id}/submissions/${submission.id}`}
                      className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-canvas sm:px-6"
                    >
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold text-brand wrap-break-word group-hover:underline group-hover:underline-offset-4">
                          {submission.formName}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.9375rem] text-ink-muted">
                          <span>{formatDateTime(submission.submittedAt)}</span>
                          <span>
                            Viitekoodi{" "}
                            <span className="font-mono font-bold tracking-[0.03em] text-ink">{submission.referenceCode}</span>
                          </span>
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
    </>
  );
}
