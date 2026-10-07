import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Page, PageHeader } from "@/components/ui/parts";

export const metadata: Metadata = { title: "Omat tiedot | Lomakeavustin" };

export default function ProfilePage() {
  return (
    <Page>
      <PageHeader title="Omat tiedot" lead="Tarkista perustietosi ja päivitä ne tarvittaessa." />
      <ProfileForm />
    </Page>
  );
}
