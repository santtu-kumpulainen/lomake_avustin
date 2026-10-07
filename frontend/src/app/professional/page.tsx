import type { Metadata } from "next";
import { ProfessionalDashboard } from "@/components/professional/ProfessionalDashboard";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Ammattilaisen työpöytä | Lomakeavustin" };

export default function ProfessionalPage() {
  return (
    <Page width="wide">
      <PageHeader
        title="Ammattilaisen työpöytä"
        lead="Yhteenveto asiakkaiden lähettämistä lomakkeista. Yksittäisten asiakkaiden tiedot eivät näy tässä näkymässä."
      />
      <ProfessionalDashboard />
    </Page>
  );
}
