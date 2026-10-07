"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { submitCredentials, type FieldErrors } from "@/lib/auth";
import { ErrorMessage, Page, TextField } from "@/components/ui/parts";
import { panel, primaryButton, textLink } from "@/components/ui/styles";

type Props = {
  mode: "login" | "register";
};

const copy = {
  login: {
    title: "Kirjaudu sisään",
    lead: "Kirjaudu täyttääksesi lomakkeita ja jatkaaksesi luonnoksia.",
    submit: "Kirjaudu",
    pending: "Kirjaudutaan…",
    switchText: "Eikö sinulla ole tiliä?",
    switchLink: "Luo tili",
    switchHref: "/register",
  },
  register: {
    title: "Luo tili",
    lead: "Tilillä voit tallentaa luonnoksia ja käyttää aiempia tietojasi uusissa lomakkeissa.",
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
    <Page width="narrow">
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight sm:text-[2rem]">{text.title}</h1>
      <p className="mt-2 text-ink-muted">{text.lead}</p>

      {/* noValidate: the backend validates and the UI shows its errors in one consistent style. */}
      <form onSubmit={handleSubmit} noValidate className={`mt-8 space-y-6 px-5 py-6 sm:px-7 sm:py-8 ${panel}`}>
        {formError && <ErrorMessage>{formError}</ErrorMessage>}

        <TextField
          name="email"
          type="email"
          label="Sähköposti"
          autoComplete="email"
          error={fieldErrors.email}
        />
        <TextField
          name="password"
          type="password"
          label="Salasana"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          hint={mode === "register" ? "Vähintään 10 merkkiä." : undefined}
          error={fieldErrors.password}
        />

        <button type="submit" disabled={pending} className={`w-full ${primaryButton}`}>
          {pending ? text.pending : text.submit}
        </button>
      </form>

      <p className="mt-6 text-ink-muted">
        {text.switchText}{" "}
        <Link href={text.switchHref} className={textLink}>
          {text.switchLink}
        </Link>
      </p>
    </Page>
  );
}
