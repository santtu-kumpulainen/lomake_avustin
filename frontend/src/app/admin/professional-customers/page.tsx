import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/AdminOnly";
import { AssignmentManager } from "@/components/admin/AssignmentManager";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Asiakkuudet | Lomakeavustin" };

export default function ProfessionalCustomersPage() {
  return (
    <Page width="wide">
      <PageHeader
        title="Asiakkuudet"
        lead="Ammattilainen näkee vain ne asiakkaat, joihin hänelle on annettu pääsy tässä."
      />
      <AdminOnly>
        <AssignmentManager />
      </AdminOnly>
    </Page>
  );
}
