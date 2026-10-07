import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormFiller } from "@/components/forms/FormFiller";
import { BackLink, Page } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Täytä lomake | Lomakeavustin" };

export default async function FillFormPage({ params, searchParams }: PageProps<"/forms/[id]">) {
  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId < 1) notFound();
  // ?draft=<id> resumes a saved draft; an invalid value just starts an empty form.
  const { draft } = await searchParams;
  const draftId = typeof draft === "string" && /^[1-9]\d*$/.test(draft) ? Number(draft) : undefined;

  return (
    <Page>
      <div className="mb-4">
        <BackLink href="/forms">Lomakkeet</BackLink>
      </div>
      <FormFiller id={templateId} draftId={draftId} />
    </Page>
  );
}
