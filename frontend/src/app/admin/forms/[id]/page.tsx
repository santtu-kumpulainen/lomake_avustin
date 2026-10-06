import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminOnly } from "@/components/admin/AdminOnly";
import { TemplateEditor } from "@/components/admin/TemplateEditor";

export const metadata: Metadata = { title: "Muokkaa lomakepohjaa | Lomakeavustin" };

export default async function FormTemplatePage({ params }: PageProps<"/admin/forms/[id]">) {
  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId < 1) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link href="/admin/forms" className="text-sm text-neutral-500 hover:text-neutral-900">
        Lomakepohjat
      </Link>
      <AdminOnly>
        <TemplateEditor id={templateId} />
      </AdminOnly>
    </main>
  );
}
