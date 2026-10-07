"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchCurrentUser, roleLabels, type User } from "@/lib/auth";
import { Chevron, Loading } from "@/components/ui/parts";
import { primaryButton, secondaryButton } from "@/components/ui/styles";

// Home page content for the signed-in user, or the sign-in choice. undefined = still loading.
export function CurrentUser() {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <Loading />;

  if (!user) {
    return (
      <>
        <h1 className="max-w-[36rem] text-[2rem] leading-tight font-bold tracking-tight text-balance sm:text-[2.5rem]">
          Täytä sosiaali- ja terveyspalvelujen lomakkeet rauhassa
        </h1>
        <p className="mt-4 max-w-[36rem] text-lg leading-relaxed text-ink-muted">
          Voit tallentaa keskeneräisen lomakkeen ja jatkaa myöhemmin, käyttää aiempia tietojasi luvallasi
          ja pyytää selityksen kysymykseen, jota et ymmärrä. Tarkistat vastauksesi ennen lähettämistä.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className={primaryButton}>
            Kirjaudu sisään
          </Link>
          <Link href="/register" className={secondaryButton}>
            Luo tili
          </Link>
        </div>
      </>
    );
  }

  const tasks = [
    ...(user.role === "USER"
      ? [
          {
            href: "/symptoms",
            title: "Kerro, miksi haet apua",
            text: "Kuvaile tilannettasi omin sanoin ja katso aiemmat kuvauksesi.",
          },
        ]
      : []),
    {
      href: "/forms",
      title: "Täytä lomake",
      text: "Valitse lomake tai jatka keskeneräistä luonnosta.",
    },
    ...(user.role === "USER"
      ? [
          {
            href: "/submissions",
            title: "Omat lähetykset",
            text: "Katso lähettämäsi lomakkeet, viitekoodit ja vastaukset.",
          },
          {
            href: "/profile",
            title: "Omat tiedot",
            text: "Tarkista nimesi, syntymäaikasi ja puhelinnumerosi.",
          },
        ]
      : []),
    ...(user.role === "ADMIN"
      ? [
          {
            href: "/admin/forms",
            title: "Hallitse lomakepohjia",
            text: "Luo, muokkaa ja julkaise lomakkeita käyttäjien täytettäväksi.",
          },
        ]
      : []),
  ];

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight sm:text-[2rem]">Mitä haluat tehdä?</h1>
      <p className="mt-2 text-ink-muted">
        Kirjautuneena {user.email} ({roleLabels[user.role].toLowerCase()})
      </p>
      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {tasks.map((task) => (
          <li key={task.href}>
            <Link href={task.href} className="group flex items-center justify-between gap-4 px-5 py-5 hover:bg-canvas sm:px-6">
              <span>
                <span className="block text-lg font-semibold text-brand group-hover:underline group-hover:underline-offset-4">
                  {task.title}
                </span>
                <span className="mt-0.5 block text-ink-muted">{task.text}</span>
              </span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
