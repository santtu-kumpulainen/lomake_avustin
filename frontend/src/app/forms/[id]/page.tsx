import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormFiller } from "@/components/forms/FormFiller";

export const metadata: Metadata = { title: "Täytä lomake | Lomakeavustin" };

export default async function FillFormPage({ params, searchParams }: PageProps<"/forms/[id]">) {
  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId < 1) notFound();
  // ?draft=<id> resumes a saved draft; an invalid value just starts an empty form.
  const { draft } = await searchParams;
  const draftId = typeof draft === "string" && /^[1-9]\d*$/.test(draft) ? Number(draft) : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link href="/forms" className="text-sm text-neutral-500 hover:text-neutral-900">
        Lomakkeet
      </Link>
      <FormFiller id={templateId} draftId={draftId} />
    </main>
  );
}
