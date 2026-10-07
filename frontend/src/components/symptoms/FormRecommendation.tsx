import Link from "next/link";
import type { FormRecommendation as Recommendation } from "@/lib/ai";
import { primaryButton, secondaryButton, textLink } from "@/components/ui/styles";

export type RecommendState =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "shown"; recommendation: Recommendation }
  | { step: "none" }
  | { step: "failed"; message: string };

export const recommendUnavailable =
  "Lomakkeen ehdottaminen ei ole juuri nyt käytettävissä. Voit valita lomakkeen itse.";

const allFormsLink = (
  <Link href="/forms" className={textLink}>
    Näytä kaikki lomakkeet
  </Link>
);

/** Result of a form recommendation. Opening the form is always the customer's own choice. */
export function FormRecommendation({ state, onDismiss }: { state: RecommendState; onDismiss: () => void }) {
  return (
    // Live region stays mounted so the loading state, result and errors are announced.
    <div aria-live="polite">
      {state.step === "loading" && <p className="sr-only">Haetaan lomake-ehdotusta.</p>}
      {state.step === "shown" && (
        <section
          aria-labelledby="recommendation-heading"
          className="mt-4 rounded-md border border-ai-line/60 bg-ai-tint px-4 py-4 transition-[opacity,translate] duration-200 starting:-translate-y-1 starting:opacity-0 sm:px-5"
        >
          <h3 id="recommendation-heading" className="text-sm font-bold text-ai">
            Suositeltu lomake
          </h3>
          {state.recommendation.category && (
            <p className="mt-2 text-[0.9375rem] text-ink-muted">{state.recommendation.category}</p>
          )}
          <p className="text-lg font-semibold leading-snug wrap-break-word text-ink">{state.recommendation.name}</p>
          <p className="mt-1 max-w-[40rem] wrap-break-word text-ink">{state.recommendation.reason}</p>
          <p className="mt-2 text-sm text-ai">
            Tekoälyn ehdotus kuvauksesi perusteella. Se ei ole arvio terveydentilastasi. Voit myös valita toisen
            lomakkeen.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link href={`/forms/${state.recommendation.formId}`} className={`w-full sm:w-auto ${primaryButton}`}>
              Avaa lomake
            </Link>
            <button type="button" onClick={onDismiss} className={`w-full sm:w-auto ${secondaryButton}`}>
              Ei nyt
            </button>
          </div>
        </section>
      )}
      {state.step === "none" && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-4 sm:px-5">
          Emme löytäneet kuvaukseesi selvästi sopivaa lomaketta. Voit tutustua kaikkiin lomakkeisiin. {allFormsLink}
        </p>
      )}
      {state.step === "failed" && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-4 text-ink-muted sm:px-5">
          {state.message} {allFormsLink}
        </p>
      )}
    </div>
  );
}
