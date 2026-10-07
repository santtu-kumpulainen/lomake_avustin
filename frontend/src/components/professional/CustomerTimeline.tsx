import Link from "next/link";
import type { TimelineEvent } from "@/lib/professional";
import { formatDateTime } from "@/lib/submissions";
import { Chevron, EmptyState } from "@/components/ui/parts";

function answerCount(n: number) {
  if (n === 0) return "Ei vastauksia";
  return n === 1 ? "1 vastaus" : `${n} vastausta`;
}

/**
 * The customer's descriptions and submitted forms in the order the backend returns them (newest
 * first). The two kinds differ by label and marker shape, so the difference is not color alone.
 */
export function CustomerTimeline({ customerId, events }: { customerId: number; events: TimelineEvent[] }) {
  if (events.length === 0) return <EmptyState title="Ei vielä tapahtumia." />;

  return (
    <ol className="relative">
      {events.map((event, index) => {
        const isSubmission = event.type === "SUBMISSION";
        const last = index === events.length - 1;
        return (
          <li key={isSubmission ? `s-${event.submissionId}` : `d-${index}`} className="relative pb-7 pl-8 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute top-5 bottom-0 left-[0.4375rem] w-px bg-line-strong/50" />}
            <span
              aria-hidden="true"
              className={
                isSubmission
                  ? "absolute top-1.5 left-0.5 size-2.5 rounded-[2px] bg-brand ring-4 ring-canvas"
                  : "absolute top-1.5 left-0.5 size-2.5 rounded-full border-2 border-ink-muted bg-canvas ring-4 ring-canvas"
              }
            />
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className={`font-semibold ${isSubmission ? "text-brand" : "text-ink"}`}>
                {isSubmission ? "Lähetetty lomake" : "Oirekuvaus"}
              </span>
              <time dateTime={event.occurredAt} className="text-[0.9375rem] text-ink-muted tabular-nums">
                {formatDateTime(event.occurredAt)}
              </time>
            </p>
            {isSubmission ? (
              <Link
                href={`/professional/customers/${customerId}/submissions/${event.submissionId}`}
                className="group mt-2 flex items-center justify-between gap-4 rounded-md border border-line bg-surface px-4 py-3 hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block font-semibold wrap-break-word group-hover:underline group-hover:underline-offset-4">
                    {event.formName}
                  </span>
                  <span className="text-[0.9375rem] text-ink-muted">{answerCount(event.answerCount)}</span>
                </span>
                <Chevron />
              </Link>
            ) : (
              <p className="mt-1 whitespace-pre-line wrap-break-word">{event.description}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
