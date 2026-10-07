"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fetchCurrentUser, type User } from "@/lib/auth";
import { Loading, Notice } from "@/components/ui/parts";
import { textLink } from "@/components/ui/styles";

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
    return <Loading />;
  }
  if (!user) {
    return (
      <Notice>
        Kirjaudu sisään ylläpitäjän tunnuksilla.{" "}
        <Link href="/login" className={textLink}>
          Kirjaudu sisään
        </Link>
      </Notice>
    );
  }
  if (user.role !== "ADMIN") {
    return <Notice>Tämä näkymä on vain ylläpitäjille.</Notice>;
  }
  return children;
}
