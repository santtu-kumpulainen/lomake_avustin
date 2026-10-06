import type { Metadata } from "next";
import Link from "next/link";
import { FormList } from "@/components/forms/FormList";

export const metadata: Metadata = { title: "Lomakkeet | Lomakeavustin" };

export default function FormsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        Lomakeavustin
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Lomakkeet</h1>
      <p className="mt-2 text-neutral-600">Valitse täytettävä lomake.</p>
      <div className="mt-8">
        <FormList />
      </div>
    </main>
  );
}
