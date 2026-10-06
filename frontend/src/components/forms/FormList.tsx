"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listTemplates, type TemplateSummary } from "@/lib/forms";
import { ErrorMessage } from "@/components/admin/parts";

export function FormList() {
  // undefined = still loading.
  const [forms, setForms] = useState<TemplateSummary[]>();
  const [status, setStatus] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listTemplates().then((result) => {
      // ADMIN also receives drafts from this endpoint; only published forms can be filled.
      if (result.ok) setForms(result.data.templates.filter((t) => t.status === "PUBLISHED"));
      else {
        setStatus(result.status);
        setError(result.formError);
      }
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
  if (!forms) return <p className="text-sm text-neutral-500">Ladataan…</p>;
  if (forms.length === 0) {
    return <p className="text-sm text-neutral-600">Täytettäviä lomakkeita ei ole juuri nyt.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
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
  );
}
