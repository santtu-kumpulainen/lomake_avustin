import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerSubmissionDetail } from "@/components/professional/CustomerSubmissionDetail";
import { BackLink, Page } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Asiakkaan lähetys | Lomakeavustin" };

export default async function CustomerSubmissionPage({
  params,
}: PageProps<"/professional/customers/[id]/submissions/[submissionId]">) {
  const { id, submissionId } = await params;
  const customerId = Number(id);
  const submission = Number(submissionId);
  if (![customerId, submission].every((value) => Number.isInteger(value) && value >= 1)) notFound();

  return (
    <Page>
      <div className="mb-4">
        <BackLink href={`/professional/customers/${customerId}`}>Asiakkaan tiedot</BackLink>
      </div>
      <CustomerSubmissionDetail customerId={customerId} submissionId={submission} />
    </Page>
  );
}
