import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SubmissionDetail } from "@/components/submissions/SubmissionDetail";
import { BackLink, Page } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Lähetetty lomake | Lomakeavustin" };

export default async function SubmissionPage({ params }: PageProps<"/submissions/[id]">) {
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId) || submissionId < 1) notFound();

  return (
    <Page>
      <div className="mb-4">
        <BackLink href="/submissions">Omat lähetykset</BackLink>
      </div>
      <SubmissionDetail id={submissionId} />
    </Page>
  );
}
