import type { Metadata } from "next";
import { SubmissionList } from "@/components/submissions/SubmissionList";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Omat lähetykset | Lomakeavustin" };

export default function SubmissionsPage() {
  return (
    <Page>
      <PageHeader
        title="Omat lähetykset"
        lead="Lomakkeet, jotka olet lähettänyt. Avaa lähetys nähdäksesi vastauksesi."
      />
      <SubmissionList />
    </Page>
  );
}
