import type { FieldType } from "@/lib/forms";
import { formatAnswer } from "@/lib/submissions";
import { textButton } from "@/components/ui/styles";

export type AnswerItem = { fieldId: number; label: string; fieldType: FieldType; value: string | null | undefined };

type Props = {
  items: AnswerItem[];
  // Shown in the summary before submitting; a submitted form is read-only.
  onEdit?: (fieldId: number) => void;
};

/** Numbered questions and readable answers, in form order. */
export function AnswerList({ items, onEdit }: Props) {
  return (
    <dl className="-mx-4 divide-y divide-line border-y border-line bg-surface sm:mx-0 sm:rounded-md sm:border-x">
      {items.map((item, index) => {
        const answer = formatAnswer(item.fieldType, item.value);
        return (
          <div key={item.fieldId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-4 sm:px-6">
            <dt className="flex gap-2 text-[0.9375rem] text-ink-muted">
              <span aria-hidden="true" className="w-5 shrink-0 tabular-nums">
                {index + 1}.
              </span>
              <span className="min-w-0 wrap-break-word">{item.label}</span>
            </dt>
            <dd className="col-start-1 mt-1 pl-7 text-lg whitespace-pre-line wrap-anywhere">
              {answer ?? <span className="text-base text-ink-subtle italic">Ei annettu</span>}
            </dd>
            {onEdit && (
              <dd className="col-start-2 row-span-2 row-start-1 -mt-1.5">
                <button
                  type="button"
                  onClick={() => onEdit(item.fieldId)}
                  aria-label={`Muokkaa: ${item.label}`}
                  className={textButton}
                >
                  Muokkaa
                </button>
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
