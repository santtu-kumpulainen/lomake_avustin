"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { recommendForm } from "@/lib/ai";
import { formatDateTime } from "@/lib/submissions";
import {
  checkDescription,
  createSymptomDescription,
  DESCRIPTION_MAX,
  listSymptomDescriptions,
  type SymptomDescription,
} from "@/lib/symptoms";
import { FormRecommendation, recommendUnavailable, type RecommendState } from "./FormRecommendation";
import { EmptyState, ErrorMessage, FieldError, Loading, Notice } from "@/components/ui/parts";
import {
  borderFor,
  hintClass,
  inputClass,
  labelClass,
  panel,
  primaryButton,
  secondaryButton,
  sectionHeading,
  textLink,
} from "@/components/ui/styles";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

export function SymptomDescriptions() {
  // undefined = still loading.
  const [history, setHistory] = useState<SymptomDescription[]>();
  const [loadStatus, setLoadStatus] = useState<number>();
  const [loadError, setLoadError] = useState<string>();
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [pending, setPending] = useState(false);
  const [recommend, setRecommend] = useState<RecommendState>({ step: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recommendButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listSymptomDescriptions().then((result) => {
      if (result.ok) setHistory(result.data.symptomDescriptions);
      else {
        setLoadStatus(result.status);
        setLoadError(result.formError);
      }
    });
  }, []);

  if (loadStatus === 401) {
    return (
      <Notice>
        Kirjaudu sisään kirjoittaaksesi kuvauksen.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  // The backend allows descriptions for customers (USER) only.
  if (loadStatus === 403) return <Notice>Kuvaukset ovat käytössä asiakkaan tunnuksilla.</Notice>;
  if (loadError) return <ErrorMessage>{loadError}</ErrorMessage>;
  if (!history) return <Loading />;

  function showFieldError(message: string) {
    setFieldError(message);
    // Keyboard and screen reader users land on the field that needs fixing.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(undefined);
    setFormError(undefined);
    const clientError = checkDescription(text);
    if (clientError) {
      showFieldError(clientError);
      return;
    }
    setFieldError(undefined);
    setPending(true);
    const result = await createSymptomDescription(text);
    setPending(false);
    if (result.ok) {
      const created = result.data.symptomDescription;
      setHistory((items) => [created, ...(items ?? [])]);
      setText("");
      setSaved(`Kuvaus tallennettu klo ${formatTime(created.createdAt)}.`);
      return;
    }
    if (result.fieldErrors.description) showFieldError(result.fieldErrors.description);
    else setFormError(result.formError ?? Object.values(result.fieldErrors)[0]);
  }

  // Uses the text as typed; nothing is saved and the textarea is left untouched.
  async function handleRecommend() {
    setSaved(undefined);
    setFormError(undefined);
    const clientError = checkDescription(text);
    if (clientError) {
      showFieldError(clientError);
      return;
    }
    setFieldError(undefined);
    setRecommend({ step: "loading" });
    const result = await recommendForm(text);
    if (result.ok) {
      const { recommendation } = result.data;
      setRecommend(recommendation ? { step: "shown", recommendation } : { step: "none" });
      return;
    }
    if (result.fieldErrors.description) {
      setRecommend({ step: "idle" });
      showFieldError(result.fieldErrors.description);
      return;
    }
    // An expired session is worth saying; every other failure gets the same plain message.
    setRecommend({ step: "failed", message: result.status === 401 ? result.formError! : recommendUnavailable });
  }

  function dismissRecommendation() {
    setRecommend({ step: "idle" });
    // The panel disappears, so focus returns to the button that asked for it.
    recommendButtonRef.current?.focus();
  }

  const length = text.trim().length;
  const tooLong = length > DESCRIPTION_MAX;

  return (
    <div className="space-y-12">
      <section aria-labelledby="new-heading">
        <h2 id="new-heading" className={sectionHeading}>
          Uusi kuvaus
        </h2>
        <form onSubmit={handleSubmit} noValidate className={`mt-4 space-y-5 px-4 py-5 sm:px-6 sm:py-6 ${panel}`}>
          {formError && <ErrorMessage>{formError}</ErrorMessage>}
          <div>
            <label htmlFor="description" className={labelClass}>
              Kuvaus
            </label>
            <p id="description-hint" className={hintClass}>
              Kirjoita vapaasti omin sanoin, vähintään 5 merkkiä.
            </p>
            <textarea
              ref={textareaRef}
              id="description"
              name="description"
              rows={6}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setFieldError(undefined);
                setSaved(undefined);
                // A suggestion for different text would be misleading.
                setRecommend({ step: "idle" });
              }}
              aria-required="true"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={["description-hint", "description-count", fieldError && "description-error"]
                .filter(Boolean)
                .join(" ")}
              className={`${inputClass} ${borderFor(fieldError)} resize-y`}
            />
            <p
              id="description-count"
              className={`mt-1.5 text-right text-[0.9375rem] tabular-nums ${tooLong ? "font-semibold text-danger" : "text-ink-subtle"}`}
            >
              {length} / {DESCRIPTION_MAX} merkkiä
            </p>
            {fieldError && <FieldError id="description-error">{fieldError}</FieldError>}
          </div>
          <p className="text-[0.9375rem] text-ink-muted">
            Tallennettu kuvaus näkyy vain omassa historiassasi, eikä sitä liitetä lomakkeisiin. Jos pyydät
            lomake-ehdotusta, kuvaus lähetetään palvelun omalle tekoälylle vain ehdotusta varten, ei ulkoisille
            palveluille. Ehdotusta ei tallenneta. Käytä vain keksittyjä tietoja.
          </p>
          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending} className={`w-full sm:w-auto ${primaryButton}`}>
              {pending ? "Tallennetaan…" : "Tallenna kuvaus"}
            </button>
            <button
              ref={recommendButtonRef}
              type="button"
              onClick={handleRecommend}
              disabled={recommend.step === "loading"}
              className={`w-full sm:w-auto ${secondaryButton} disabled:cursor-wait`}
            >
              {recommend.step === "loading" ? "Haetaan ehdotusta…" : "Ehdota sopivaa lomaketta"}
            </button>
            <p role="status" className="font-semibold text-brand empty:hidden">
              {saved}
            </p>
          </div>
        </form>
        <FormRecommendation state={recommend} onDismiss={dismissRecommendation} />
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className={sectionHeading}>
          Aiemmat kuvaukset
        </h2>
        <div className="mt-4">
          {history.length === 0 ? (
            <EmptyState title="Et ole vielä kirjoittanut kuvauksia." />
          ) : (
            <ol className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {history.map((item) => (
                <li key={item.id} className="px-5 py-4 sm:px-6">
                  <p className="text-[0.9375rem] text-ink-muted">
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  </p>
                  <p className="mt-1 whitespace-pre-line wrap-break-word">{item.description}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
