"use client";

import { useRef, useState } from "react";
import { explainQuestion } from "@/lib/ai";
import type { FormField } from "@/lib/forms";

type HelpState =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "shown"; text: string }
  | { step: "failed"; message: string };

const unavailable =
  "AI-avustus ei ole tällä hetkellä käytettävissä. Voit jatkaa lomakkeen täyttämistä normaalisti.";

/** State for one field's AI explanation. The answer value is never read or changed here. */
export function useQuestionHelp(field: FormField) {
  const [state, setState] = useState<HelpState>({ step: "idle" });

  async function request() {
    setState({ step: "loading" });
    const result = await explainQuestion(field);
    if (result.ok) setState({ step: "shown", text: result.data.explanation });
    // An expired session is worth saying; every other failure gets the same plain message.
    else setState({ step: "failed", message: result.status === 401 ? result.formError! : unavailable });
  }

  return { state, request, close: () => setState({ step: "idle" }) };
}

type QuestionHelpProps = {
  help: ReturnType<typeof useQuestionHelp>;
  // Referenced from the input's aria-describedby while an explanation is shown.
  panelId: string;
  label: string;
};

export function QuestionHelp({ help, panelId, label }: QuestionHelpProps) {
  const { state, request, close } = help;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const loading = state.step === "loading";

  function handleClose() {
    close();
    // The close button disappears, so focus returns to the button that opened the explanation.
    buttonRef.current?.focus();
  }

  return (
    <div className="mt-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={request}
        disabled={loading}
        aria-controls={panelId}
        aria-label={`Selitä kysymys: ${label}`}
        className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded px-1 text-[0.9375rem] font-semibold text-ai underline decoration-ai-line decoration-1 underline-offset-4 hover:decoration-ai disabled:cursor-wait disabled:no-underline"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.75" />
          <path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.45.2-.75.6-.75 1.1v.3" />
          <circle cx="8" cy="11.4" r=".2" fill="currentColor" />
        </svg>
        {loading ? "Haetaan selitystä…" : "Selitä kysymys"}
      </button>
      {/* Live region stays mounted so the loading state, result and errors are announced. */}
      <div id={panelId} aria-live="polite">
        {loading && <p className="sr-only">Haetaan AI-selitystä kysymykseen.</p>}
        {state.step === "shown" && (
          <div className="mt-2 mb-1 rounded-md border border-ai-line/60 bg-ai-tint px-4 py-3 transition-[opacity,translate] duration-200 starting:-translate-y-1 starting:opacity-0">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-bold text-ai">AI-avustus</p>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Sulje selitys"
                className="-mt-1.5 -mr-2 inline-flex min-h-9 items-center gap-1 rounded px-2 text-sm font-semibold text-ai hover:bg-ai-line/20"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="m3 3 8 8M11 3l-8 8" />
                </svg>
                Sulje
              </button>
            </div>
            <p className="mt-1 max-w-[40rem] whitespace-pre-line text-ink">{state.text}</p>
            <p className="mt-2 text-sm text-ai">
              Tekoälyn tuottama selitys. Se ei korvaa kysymystä eikä ammattilaisen arviota.
            </p>
          </div>
        )}
        {state.step === "failed" && (
          <p className="mt-1 mb-1 text-[0.9375rem] text-ink-muted">{state.message}</p>
        )}
      </div>
    </div>
  );
}
