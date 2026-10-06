import type { ReactNode } from "react";
import type { TemplateStatus } from "@/lib/forms";
import { borderFor, inputClass } from "./styles";

export function ErrorMessage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`border-l-2 border-red-700 pl-3 text-sm text-red-800 ${className}`}>
      {children}
    </p>
  );
}

export function StatusBadge({ status, label }: { status: TemplateStatus; label: string }) {
  const tone =
    status === "PUBLISHED"
      ? "border-emerald-700 text-emerald-800"
      : "border-neutral-400 text-neutral-600";
  return <span className={`inline-block border px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

type TextFieldProps = {
  name: string;
  label: string;
  // Several forms share a page, so ids get a prefix to stay unique.
  idPrefix?: string;
  defaultValue?: string | null;
  optional?: boolean;
  multiline?: boolean;
  hint?: string;
  error?: string;
};

export function TextField({
  name,
  label,
  idPrefix = "",
  defaultValue,
  optional,
  multiline,
  hint,
  error,
}: TextFieldProps) {
  const id = `${idPrefix}${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    name,
    defaultValue: defaultValue ?? "",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: `${inputClass} ${borderFor(error)}`,
  };
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {optional && <span className="font-normal text-neutral-500"> (valinnainen)</span>}
      </label>
      {multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-800">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-neutral-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
