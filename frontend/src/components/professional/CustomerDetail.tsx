"use client";

import { useEffect, useState } from "react";
import {
  customerName,
  formatDate,
  getCustomer,
  getCustomerTimeline,
  type CustomerAccess,
  type CustomerProfile,
  type TimelineEvent,
} from "@/lib/professional";
import { formatDateTime } from "@/lib/submissions";
import { Badge, ErrorMessage, Loading, PageHeader } from "@/components/ui/parts";
import { panel, sectionHeading } from "@/components/ui/styles";
import { CustomerAccessState } from "./CustomerAccessState";
import { CustomerTimeline } from "./CustomerTimeline";

type Failure = { status: number; error?: string };

/** Read-only view of one assigned customer. Shows stored data only, with no interpretation. */
export function CustomerDetail({ id }: { id: number }) {
  // undefined = still loading.
  const [customer, setCustomer] = useState<CustomerProfile>();
  const [access, setAccess] = useState<CustomerAccess>();
  const [timeline, setTimeline] = useState<TimelineEvent[]>();
  const [failure, setFailure] = useState<Failure>();
  const [timelineError, setTimelineError] = useState(false);

  useEffect(() => {
    // The profile request decides access; the timeline loads only once it succeeds.
    getCustomer(id).then((result) => {
      if (!result.ok) {
        setFailure({ status: result.status, error: result.formError });
        return;
      }
      setCustomer(result.data.customer);
      setAccess(result.data.access);
      getCustomerTimeline(id).then((r) => (r.ok ? setTimeline(r.data.timeline) : setTimelineError(true)));
    });
  }, [id]);

  if (failure) return <CustomerAccessState status={failure.status} error={failure.error} />;
  if (!customer) return <Loading>Ladataan asiakkaan tietoja…</Loading>;

  const notGiven = <span className="text-ink-subtle italic">Ei annettu</span>;

  return (
    <>
      <PageHeader
        title={customerName(customer)}
        meta={<Badge>Vain luku</Badge>}
        lead={
          // Why and until when this professional has access; set by an admin.
          access && (
            <dl className="grid gap-x-3 text-base sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt>Käyttötarkoitus:</dt>
              <dd className="text-ink wrap-anywhere">{access.purpose ?? "Ei annettu"}</dd>
              <dt className="mt-1 sm:mt-0">Pääsy:</dt>
              <dd className="text-ink">
                {access.expiresAt ? `päättyy ${formatDateTime(access.expiresAt)}` : "voimassa toistaiseksi"}
              </dd>
            </dl>
          )
        }
      />

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

        <section aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className={sectionHeading}>
            Tapahtumat
          </h2>
          <p className="mt-1 text-ink-muted">Asiakkaan oirekuvaukset ja lähettämät lomakkeet, uusin ensin.</p>
          <div className="mt-5">
            {timelineError ? (
              <ErrorMessage>Tapahtumia ei voitu hakea. Lataa sivu uudelleen.</ErrorMessage>
            ) : timeline === undefined ? (
              <Loading>Ladataan tapahtumia…</Loading>
            ) : (
              <CustomerTimeline customerId={id} events={timeline} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
