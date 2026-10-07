// Shared class strings. Components compose these instead of repeating long Tailwind lists.

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55";

export const primaryButton = `${buttonBase} bg-brand text-white hover:bg-brand-hover`;
export const secondaryButton = `${buttonBase} border border-line-strong bg-surface text-ink hover:border-ink hover:bg-canvas`;
export const smallButton =
  "inline-flex min-h-9 items-center rounded border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40";
// Low-emphasis action that still reads as a button (e.g. "Muokkaa").
export const textButton =
  "inline-flex min-h-9 items-center rounded px-1 text-sm font-semibold text-brand underline decoration-1 underline-offset-4 hover:decoration-2";
export const dangerTextButton =
  "inline-flex min-h-9 items-center rounded px-1 text-sm font-semibold text-danger underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-55";
export const textLink = "font-semibold text-brand underline decoration-1 underline-offset-4 hover:decoration-2";

// 16px text keeps mobile browsers from zooming into the field on focus.
export const inputClass =
  "mt-2 block min-h-11 w-full rounded border bg-surface px-3 py-2 text-base text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/25";
export const selectClass = `${inputClass} select-native`;

export const labelClass = "block font-semibold leading-snug text-ink";
export const hintClass = "mt-1 text-[0.9375rem] leading-normal text-ink-subtle";
export const fieldErrorClass = "mt-2 flex gap-1.5 text-[0.9375rem] font-semibold text-danger";

export const sectionHeading = "text-xl font-semibold leading-tight tracking-tight text-ink";
export const panel = "rounded-md border border-line bg-surface";

export function borderFor(error?: string) {
  return error ? "border-danger" : "border-line-strong";
}
