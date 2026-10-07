import { CurrentUser } from "@/components/CurrentUser";
import { Page } from "@/components/ui/parts";

// Rendered per request so the status reflects the backend right now.
export const dynamic = "force-dynamic";

type Health = {
  status: string;
  database: string;
};

async function getHealth(): Promise<Health | null> {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${backendUrl}/api/health`, { cache: "no-store" });
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

const statusText = (value: string) => (value === "ok" ? "toiminnassa" : value);

export default async function Home() {
  const health = await getHealth();
  const healthy = health?.status === "ok" && health.database === "ok";

  return (
    <Page>
      <CurrentUser />

      {/* Kept for the MVP demo: shows at a glance whether the backend and database respond. */}
      <section aria-labelledby="status-heading" className="mt-16 border-t border-line pt-6 text-sm">
        <h2 id="status-heading" className="font-semibold">
          Palvelun tila
        </h2>
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-ink-muted">
          <dt>Taustapalvelu</dt>
          <dd>{health ? statusText(health.status) : "ei yhteyttä"}</dd>
          <dt>Tietokanta</dt>
          <dd>{health ? statusText(health.database) : "tuntematon"}</dd>
        </dl>
        {!healthy && <p className="mt-2 font-semibold text-danger">Palvelussa on häiriö. Kaikki toiminnot eivät ehkä toimi.</p>}
      </section>
    </Page>
  );
}
