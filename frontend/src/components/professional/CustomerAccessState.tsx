import Link from "next/link";
import { ErrorMessage, Notice } from "@/components/ui/parts";
import { textLink } from "@/components/ui/styles";

/**
 * Explains a refused customer request. An unassigned customer is a 404 like a missing one,
 * so the message never says whether the customer exists.
 */
export function CustomerAccessState({ status, error }: { status?: number; error?: string }) {
  if (status === 401) {
    return (
      <Notice>
        Kirjaudu sisään ammattilaisen tunnuksilla.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  if (status === 403) return <Notice>Tämä näkymä on vain ammattilaisille.</Notice>;
  if (status === 404) {
    return <ErrorMessage>Tietoja ei löytynyt, tai sinulla ei ole pääsyä tähän asiakkaaseen.</ErrorMessage>;
  }
  return <ErrorMessage>{error ?? "Tietoja ei voitu hakea. Yritä hetken kuluttua uudelleen."}</ErrorMessage>;
}
