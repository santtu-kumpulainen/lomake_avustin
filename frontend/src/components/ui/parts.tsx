import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import type { TemplateStatus } from "@/lib/forms";
import { borderFor, fieldErrorClass, hintClass, inputClass, labelClass } from "./styles";

const widths = { narrow: "max-w-md", default: "max-w-2xl", wide: "max-w-4xl" };

/** Page body. The id is the skip link's target. */
export function Page({ width = "default", children }: { width?: keyof typeof widths; children: ReactNode }) {
  return (
    <main id="sisalto" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 pt-8 pb-16 outline-none sm:px-6 sm:pt-12 ${widths[width]}`}>
      {children}
    </main>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded px-1 text-[0.9375rem] font-semibold text-ink-muted hover:text-ink"
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m10 4-4 4 4 4" />
      </svg>
      {children}
    </Link>
  );
}

type PageHeaderProps = {
  title: ReactNode;
  lead?: ReactNode;
  back?: { href: string; label: string };
  // Badges, status lines or actions shown next to or under the title.
  meta?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, lead, back, meta, actions }: PageHeaderProps) {
  return (
    <header className="mb-8">
      {back && (
        <div className="mb-4">
          <BackLink href={back.href}>{back.label}</BackLink>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[40rem]">
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-balance wrap-break-word sm:text-[2rem]">
            {title}
          </h1>
          {meta && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">{meta}</div>}
          {lead && <div className="mt-3 text-lg leading-relaxed text-ink-muted">{lead}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
    </header>
  );
}

const badgeTones = {
  neutral: "border-line-strong/50 bg-canvas text-ink-muted",
  brand: "border-brand/30 bg-brand-tint text-brand",
  draft: "border-draft/30 bg-draft-tint text-draft",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-sm font-semibold ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: TemplateStatus; label: string }) {
  return <Badge tone={status === "PUBLISHED" ? "brand" : status === "DRAFT" ? "draft" : "neutral"}>{label}</Badge>;
}

/** Trailing chevron for whole-row links; reacts to a parent `group` hover. */
export function Chevron() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand">
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="currentColor" className="mt-[0.2rem] shrink-0">
      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

/** Field-level error; the icon means the state is not shown by color alone. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className={fieldErrorClass}>
      <AlertIcon />
      <span>{children}</span>
    </p>
  );
}

export function ErrorMessage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`flex gap-2 rounded-md border border-danger/40 bg-danger-tint px-4 py-3 text-danger ${className}`}>
      <AlertIcon />
      <div className="min-w-0 font-semibold">{children}</div>
    </div>
  );
}

const noticeTones = {
  neutral: "border-line bg-surface",
  brand: "border-brand/30 bg-brand-tint",
};

/** Calm informational block, e.g. the prefill offer or a "saved" confirmation. */
export function Notice({
  tone = "neutral",
  className = "",
  children,
  ...rest
}: {
  tone?: keyof typeof noticeTones;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`rounded-md border px-4 py-4 sm:px-5 ${noticeTones[tone]} ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function Loading({ children = "Ladataan…", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 text-ink-muted ${className}`}>
      <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line border-t-brand motion-reduce:animate-none" />
      {children}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong/60 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-ink-muted">{children}</div>}
    </div>
  );
}

type TextFieldProps = {
  name: string;
  label: string;
  // Several forms share a page, so ids get a prefix to stay unique.
  idPrefix?: string;
  defaultValue?: string | null;
  optional?: boolean;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  error?: string;
  type?: string;
  autoComplete?: string;
};

export function TextField({
  name,
  label,
  idPrefix = "",
  defaultValue,
  optional,
  required,
  multiline,
  hint,
  error,
  type = "text",
  autoComplete,
}: TextFieldProps) {
  const id = `${idPrefix}${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const shared = {
    id,
    name,
    defaultValue: defaultValue ?? undefined,
    autoComplete,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    className: `${inputClass} ${borderFor(error)}`,
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        {optional && <span className="font-normal text-ink-subtle"> (valinnainen)</span>}
      </label>
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      {multiline ? <textarea rows={3} {...shared} /> : <input type={type} {...shared} />}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
