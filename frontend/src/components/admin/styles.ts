// Shared classes for the admin screens, matching the auth form styling.
export const inputClass =
  "mt-1.5 block w-full border bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900";
export const primaryButton =
  "bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60";
export const secondaryButton =
  "border border-neutral-300 px-4 py-2 text-sm font-medium hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60";
export const smallButton =
  "border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-40";
export const sectionHeading = "text-sm font-medium uppercase tracking-wide text-neutral-500";

export function borderFor(error?: string) {
  return error ? "border-red-700" : "border-neutral-300";
}
