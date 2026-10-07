"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AssignedCustomers } from "./AssignedCustomers";
import { getProfessionalDashboard, type ProfessionalDashboard as Dashboard } from "@/lib/professional";
import { Badge, EmptyState, ErrorMessage, Loading, Notice } from "@/components/ui/parts";
import { panel, sectionHeading, textLink } from "@/components/ui/styles";

const numberFormat = new Intl.NumberFormat("fi-FI");

// The backend decides access; the 401 and 403 states only explain what happened.
export function ProfessionalDashboard() {
  // undefined = still loading.
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [status, setStatus] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getProfessionalDashboard().then((result) => {
      if (result.ok) setDashboard(result.data.dashboard);
      else {
        setStatus(result.status);
        setError(result.formError);
      }
    });
  }, []);

  if (status === 401) {
    return (
      <Notice>
        Kirjaudu sisään ammattilaisen tunnuksilla.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  if (status === 403) return <Notice>Tämä näkymä on vain ammattilaisille.</Notice>;
  if (error) return <ErrorMessage>Työpöydän tietoja ei voitu hakea. Yritä hetken kuluttua uudelleen.</ErrorMessage>;
  if (!dashboard) return <Loading>Ladataan työpöytää…</Loading>;

  const { submittedForms, formsLast7Days } = dashboard;
  const stats = [
    { label: "Tänään", value: submittedForms.today },
    { label: "Viimeiset 7 päivää", value: submittedForms.last7Days },
    { label: "Yhteensä", value: submittedForms.total },
  ];

  return (
    <div className="space-y-10">
      <section aria-labelledby="customers-heading">
        <h2 id="customers-heading" className={sectionHeading}>
          Omat asiakkaat
        </h2>
        <p className="mt-1 max-w-[40rem] text-ink-muted">
          Näet vain asiakkaat, joihin ylläpitäjä on antanut sinulle pääsyn. Tiedot ovat vain luettavissa.
        </p>
        <div className="mt-4">
          <AssignedCustomers />
        </div>
      </section>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className={sectionHeading}>
          Lähetetyt lomakkeet
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={`${panel} flex items-baseline justify-between gap-4 px-5 py-4 sm:block sm:px-6 sm:py-5`}
            >
              <dt className="text-[0.9375rem] font-semibold text-ink-muted">{stat.label}</dt>
              <dd className="text-[2rem] leading-none font-bold tracking-tight tabular-nums sm:mt-3 sm:text-[2.5rem]">
                {numberFormat.format(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[0.9375rem] text-ink-subtle">
          Asiakkaiden lähettämät lomakkeet Suomen ajan mukaan. Luonnoksia ja henkilöstön omia lähetyksiä ei lasketa.
        </p>
      </section>

      <section aria-labelledby="forms-heading">
        <h2 id="forms-heading" className={sectionHeading}>
          Lähetetyimmät lomakkeet, 7 päivää
        </h2>
        <div className="mt-4">
          {formsLast7Days.length === 0 ? (
            <EmptyState
              title={
                submittedForms.total === 0
                  ? "Asiakkaat eivät ole vielä lähettäneet lomakkeita."
                  : "Viimeisen 7 päivän aikana ei ole lähetetty lomakkeita."
              }
            >
              Lähetykset näkyvät tässä lomakkeittain, kun asiakkaat lähettävät niitä.
            </EmptyState>
          ) : (
            <table className={`${panel} w-full border-separate border-spacing-0 overflow-hidden text-left`}>
              <caption className="sr-only">Asiakkaiden lähetykset lomakkeittain viimeisen 7 päivän aikana</caption>
              <thead>
                <tr className="text-[0.9375rem] text-ink-muted">
                  <th scope="col" className="border-b border-line px-5 py-3 font-semibold sm:px-6">
                    Lomake
                  </th>
                  <th scope="col" className="border-b border-line px-5 py-3 text-right font-semibold sm:px-6">
                    Lähetyksiä
                  </th>
                </tr>
              </thead>
              <tbody>
                {formsLast7Days.map((form, index) => {
                  const border = index > 0 ? "border-t border-line" : "";
                  return (
                    <tr key={form.formTemplateId}>
                      <th scope="row" className={`${border} px-5 py-4 align-top font-normal sm:px-6`}>
                        <span className="block font-semibold wrap-break-word">{form.name}</span>
                        {form.category && (
                          <span className="mt-1.5 block">
                            <Badge>{form.category}</Badge>
                          </span>
                        )}
                      </th>
                      <td className={`${border} px-5 py-4 text-right align-top text-lg font-bold tabular-nums sm:px-6`}>
                        {numberFormat.format(form.submittedForms)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
