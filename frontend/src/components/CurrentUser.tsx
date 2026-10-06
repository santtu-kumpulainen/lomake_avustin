"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchCurrentUser, logout, roleLabels, type User } from "@/lib/auth";

// undefined = still loading, null = not signed in.
export function CurrentUser() {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  if (user === undefined) {
    return <p className="mt-4 text-sm text-neutral-500">Ladataan…</p>;
  }

  if (!user) {
    return (
      <div className="mt-4 flex gap-3 text-sm">
        <Link href="/login" className="bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700">
          Kirjaudu sisään
        </Link>
        <Link href="/register" className="border border-neutral-300 px-4 py-2 font-medium hover:border-neutral-900">
          Luo tili
        </Link>
      </div>
    );
  }

  return (
    <>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-neutral-500">Sähköposti</dt>
        <dd>{user.email}</dd>
        <dt className="text-neutral-500">Rooli</dt>
        <dd>
          {roleLabels[user.role]} <span className="text-neutral-500">({user.role})</span>
        </dd>
      </dl>
      <p className="mt-5 flex gap-5 text-sm">
        <Link href="/forms" className="font-medium underline underline-offset-4">
          Täytä lomake
        </Link>
        {user.role === "ADMIN" && (
          <Link href="/admin/forms" className="font-medium underline underline-offset-4">
            Hallitse lomakepohjia
          </Link>
        )}
      </p>
      <button
        type="button"
        onClick={handleLogout}
        className="mt-5 border border-neutral-300 px-4 py-2 text-sm font-medium hover:border-neutral-900"
      >
        Kirjaudu ulos
      </button>
    </>
  );
}
