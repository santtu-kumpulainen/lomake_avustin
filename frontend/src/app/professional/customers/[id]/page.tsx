import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerDetail } from "@/components/professional/CustomerDetail";
import { BackLink, Page } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Asiakas | Lomakeavustin" };

export default async function CustomerPage({ params }: PageProps<"/professional/customers/[id]">) {
  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId < 1) notFound();

  return (
    <Page>
      <div className="mb-4">
        <BackLink href="/professional">Työpöytä</BackLink>
      </div>
      <CustomerDetail id={customerId} />
    </Page>
  );
}
