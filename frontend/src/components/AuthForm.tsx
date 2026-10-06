"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { submitCredentials, type FieldErrors } from "@/lib/auth";

type Props = {
  mode: "login" | "register";
};

const copy = {
  login: {
    title: "Kirjaudu sisään",
    submit: "Kirjaudu",
    pending: "Kirjaudutaan…",
    switchText: "Eikö sinulla ole tiliä?",
    switchLink: "Luo tili",
    switchHref: "/register",
  },
  register: {
    title: "Luo tili",
    submit: "Luo tili",
    pending: "Luodaan tiliä…",
    switchText: "Onko sinulla jo tili?",
    switchLink: "Kirjaudu sisään",
    switchHref: "/login",
  },
};

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const text = copy[mode];
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFormError(undefined);
    setFieldErrors({});

    const result = await submitCredentials(
      mode,
      String(data.get("email") ?? ""),
      String(data.get("password") ?? ""),
    );

    if (result.ok) {
      router.push("/");
      return;
    }
    setFieldErrors(result.fieldErrors);
    setFormError(result.formError);
    setPending(false);
  }

  return (
    <main className="mx-auto w-full max-w-sm px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        Lomakeavustin
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{text.title}</h1>

      {/* noValidate: the backend validates and the UI shows its errors in one consistent style. */}
      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {formError && (
          <p role="alert" className="border-l-2 border-red-700 pl-3 text-sm text-red-800">
            {formError}
          </p>
        )}

        <Field
          name="email"
          type="email"
          label="Sähköposti"
          autoComplete="email"
          error={fieldErrors.email}
        />
        <Field
          name="password"
          type="password"
          label="Salasana"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          hint={mode === "register" ? "Vähintään 10 merkkiä." : undefined}
          error={fieldErrors.password}
        />

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60"
        >
          {pending ? text.pending : text.submit}
        </button>
      </form>

      <p className="mt-8 text-sm text-neutral-600">
        {text.switchText}{" "}
        <Link href={text.switchHref} className="font-medium text-neutral-900 underline underline-offset-4">
          {text.switchLink}
        </Link>
      </p>
    </main>
  );
}

type FieldProps = {
  name: string;
  type: string;
  label: string;
  autoComplete: string;
  hint?: string;
  error?: string;
};

function Field({ name, type, label, autoComplete, hint, error }: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 block w-full border bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 ${
          error ? "border-red-700" : "border-neutral-300"
        }`}
      />
      {error ? (
        <p id={`${name}-error`} className="mt-1.5 text-sm text-red-800">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${name}-hint`} className="mt-1.5 text-sm text-neutral-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
