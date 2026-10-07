"use client";

import { useRef, useState } from "react";
import { explainQuestion } from "@/lib/ai";
import type { FormField } from "@/lib/forms";
import { smallButton } from "@/components/admin/styles";

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
    <div className="mt-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={request}
        disabled={loading}
        aria-controls={panelId}
        aria-label={`Selitä kysymys: ${label}`}
        className={smallButton}
      >
        {loading ? "Haetaan selitystä…" : "Selitä kysymys"}
      </button>
      {/* Live region stays mounted so the loading state, result and errors are announced. */}
      <div id={panelId} aria-live="polite">
        {loading && <p className="sr-only">Haetaan AI-selitystä kysymykseen.</p>}
        {state.step === "shown" && (
          <div className="mt-2 border-l-2 border-neutral-400 bg-neutral-50 py-2 pl-3 pr-2 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">AI-avustus</p>
            <p className="mt-1 whitespace-pre-line text-neutral-800">{state.text}</p>
            <p className="mt-1.5 text-xs text-neutral-500">
              Tekoälyn tuottama selitys. Se ei korvaa kysymystä eikä ammattilaisen arviota.
            </p>
            <button type="button" onClick={handleClose} className={`mt-2 ${smallButton}`}>
              Sulje selitys
            </button>
          </div>
        )}
        {state.step === "failed" && <p className="mt-2 text-sm text-neutral-700">{state.message}</p>}
      </div>
    </div>
  );
}
