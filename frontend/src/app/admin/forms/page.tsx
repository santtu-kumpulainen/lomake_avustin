import type { Metadata } from "next";
import Link from "next/link";
import { AdminOnly } from "@/components/admin/AdminOnly";
import { TemplateList } from "@/components/admin/TemplateList";

export const metadata: Metadata = { title: "Lomakepohjat | Lomakeavustin" };

export default function FormTemplatesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        Lomakeavustin
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Lomakepohjat</h1>
      <p className="mt-2 text-neutral-600">Luo ja julkaise lomakkeita käyttäjien täytettäväksi.</p>
      <div className="mt-8">
        <AdminOnly>
          <TemplateList />
        </AdminOnly>
      </div>
    </main>
  );
}
