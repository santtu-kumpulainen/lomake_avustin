import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminOnly } from "@/components/admin/AdminOnly";
import { TemplateEditor } from "@/components/admin/TemplateEditor";
import { BackLink, Page } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Muokkaa lomakepohjaa | Lomakeavustin" };

export default async function FormTemplatePage({ params }: PageProps<"/admin/forms/[id]">) {
  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId < 1) notFound();

  return (
    <Page width="wide">
      <div className="mb-4">
        <BackLink href="/admin/forms">Lomakepohjat</BackLink>
      </div>
      <AdminOnly>
        <TemplateEditor id={templateId} />
      </AdminOnly>
    </Page>
  );
}
