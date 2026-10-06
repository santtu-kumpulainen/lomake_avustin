"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fetchCurrentUser, type User } from "@/lib/auth";

// Hides admin screens from other roles. The backend still enforces authorization on every request.
export function AdminOnly({ children }: { children: ReactNode }) {
  // undefined = still loading, null = not signed in.
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return <p className="text-sm text-neutral-500">Ladataan…</p>;
  }
  if (!user) {
    return (
      <p className="text-sm">
        Kirjaudu sisään ylläpitäjän tunnuksilla.{" "}
        <Link href="/login" className="font-medium underline underline-offset-4">
          Kirjaudu sisään
        </Link>
      </p>
    );
  }
  if (user.role !== "ADMIN") {
    return <p className="text-sm">Tämä näkymä on vain ylläpitäjille.</p>;
  }
  return children;
}
