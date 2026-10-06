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

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Lomakeavustin</h1>
      <p className="mt-2 text-neutral-600">
        MVP. Käyttää vain synteettistä dataa.
      </p>

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Järjestelmän tila
        </h2>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-neutral-500">Backend</dt>
          <dd>{health ? health.status : "ei yhteyttä"}</dd>
          <dt className="text-neutral-500">Tietokanta</dt>
          <dd>{health ? health.database : "tuntematon"}</dd>
        </dl>
      </section>
    </main>
  );
}
