import type { Metadata } from "next";
import { FormList } from "@/components/forms/FormList";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Lomakkeet | Lomakeavustin" };

export default function FormsPage() {
  return (
    <Page>
      <PageHeader title="Lomakkeet" lead="Valitse täytettävä lomake tai jatka keskeneräistä luonnosta." />
      <FormList />
    </Page>
  );
}
