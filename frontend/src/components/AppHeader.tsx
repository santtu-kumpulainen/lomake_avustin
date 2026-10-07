"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchCurrentUser, logout, roleLabels, type User } from "@/lib/auth";

// Navigation is a convenience only; the backend authorizes every request.
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  // undefined = still loading, null = not signed in.
  const [user, setUser] = useState<User | null>();
  const [pending, setPending] = useState(false);

  // Re-checked on navigation so the header follows login and session expiry.
  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, [pathname]);

  async function handleLogout() {
    setPending(true);
    await logout();
    // Leaving the page unmounts its client state from the previous session.
    setUser(null);
    setPending(false);
    router.replace("/login");
  }

  const links = user
    ? [
        { href: "/forms", label: "Lomakkeet" },
        ...(user.role === "USER" ? [{ href: "/profile", label: "Omat tiedot" }] : []),
        ...(user.role === "ADMIN" ? [{ href: "/admin/forms", label: "Lomakepohjat" }] : []),
      ]
    : [];
  const isAuthPage = pathname === "/login" || pathname === "/register";

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-8 gap-y-1 px-4 sm:px-6">
        <Link href="/" className="-ml-1 flex min-h-14 items-center gap-2.5 rounded px-1 text-lg font-bold tracking-tight">
          <Mark />
          Lomakeavustin
        </Link>

        {links.length > 0 && (
          <nav aria-label="Päävalikko" className="order-last -mx-1 flex w-full gap-1 sm:order-none sm:w-auto">
            {links.map((link) => {
              const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={`relative flex min-h-11 items-center rounded px-2 font-semibold sm:min-h-14 ${
                    current
                      ? "text-brand after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-sm after:bg-brand"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-4">
          {user && (
            <>
              <p className="hidden text-right text-sm leading-tight md:block">
                <span className="block max-w-56 truncate font-semibold">{user.email}</span>
                <span className="text-ink-subtle">{roleLabels[user.role]}</span>
              </p>
              <button
                type="button"
                onClick={handleLogout}
                disabled={pending}
                className="min-h-9 rounded px-1 text-[0.9375rem] font-semibold text-ink-muted underline decoration-1 underline-offset-4 hover:text-ink disabled:opacity-55"
              >
                Kirjaudu ulos
              </button>
            </>
          )}
          {user === null && !isAuthPage && (
            <Link
              href="/login"
              className="min-h-9 rounded px-1 text-[0.9375rem] font-semibold text-brand underline decoration-1 underline-offset-4"
            >
              Kirjaudu sisään
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

// A form sheet with a checked line: the product in one glyph.
function Mark() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="0.75" y="0.75" width="24.5" height="24.5" rx="5" fill="#1d5245" />
      <path d="M7 9h12M7 13h8" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
      <path d="m7 18 2 2 4-4" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
