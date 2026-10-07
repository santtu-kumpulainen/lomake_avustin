import type { Metadata } from "next";
import { SymptomDescriptions } from "@/components/symptoms/SymptomDescriptions";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Miksi haet apua? | Lomakeavustin" };

export default function SymptomsPage() {
  return (
    <Page>
      <PageHeader
        title="Miksi haet apua?"
        lead="Kerro omin sanoin, mihin tarvitset apua tai mitä asiaa haluat käsitellä."
      />
      <SymptomDescriptions />
    </Page>
  );
}
