"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { customerName, formatDate, listAssignedCustomers, type AssignedCustomer } from "@/lib/professional";
import { Chevron, EmptyState, ErrorMessage, Loading } from "@/components/ui/parts";

/** Customers explicitly assigned to the signed-in professional; the backend decides who is listed. */
export function AssignedCustomers() {
  // undefined = still loading.
  const [customers, setCustomers] = useState<AssignedCustomer[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listAssignedCustomers().then((result) => {
      if (result.ok) setCustomers(result.data.customers);
      else setError(result.formError);
    });
  }, []);

  if (error) return <ErrorMessage>Asiakaslistaa ei voitu hakea. Yritä hetken kuluttua uudelleen.</ErrorMessage>;
  if (!customers) return <Loading>Ladataan asiakkaita…</Loading>;
  if (customers.length === 0) {
    return (
      <EmptyState title="Sinulle ei ole vielä määritetty asiakkaita.">
        Ylläpitäjä antaa pääsyn asiakkaisiin. Asiakkaat näkyvät tässä, kun pääsy on annettu.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {customers.map((customer) => (
        <li key={customer.id}>
          <Link
            href={`/professional/customers/${customer.id}`}
            className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-canvas sm:px-6"
          >
            <span className="min-w-0">
              <span className="block text-lg font-semibold text-brand wrap-break-word group-hover:underline group-hover:underline-offset-4">
                {customerName(customer)}
              </span>
              <span className="mt-1 block text-[0.9375rem] text-ink-muted">
                {customer.dateOfBirth ? `Syntynyt ${formatDate(customer.dateOfBirth)}` : "Syntymäaikaa ei ole annettu"}
              </span>
            </span>
            <Chevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}
