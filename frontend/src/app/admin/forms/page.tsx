import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/AdminOnly";
import { TemplateList } from "@/components/admin/TemplateList";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Lomakepohjat | Lomakeavustin" };

export default function FormTemplatesPage() {
  return (
    <Page width="wide">
      <PageHeader title="Lomakepohjat" lead="Luo ja julkaise lomakkeita käyttäjien täytettäväksi." />
      <AdminOnly>
        <TemplateList />
      </AdminOnly>
    </Page>
  );
}
