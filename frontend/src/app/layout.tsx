import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// Designed for low-vision readers; self-hosted by next/font, so no requests go to Google at runtime.
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
});
const atkinsonMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-atkinson-mono",
});

export const metadata: Metadata = {
  title: "Lomakeavustin",
  description: "Älykäs lomakeavustin (MVP, synteettinen data)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fi" className={`h-full antialiased ${atkinson.variable} ${atkinsonMono.variable}`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#sisalto"
          className="sr-only z-50 rounded bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Siirry sisältöön
        </a>
        <AppHeader />
        {children}
        <footer className="border-t border-line">
          <p className="mx-auto max-w-4xl px-4 py-6 text-sm text-ink-subtle sm:px-6">
            Lomakeavustin on MVP-demo. Käytä vain keksittyjä tietoja, älä oikeita henkilö- tai terveystietoja.
          </p>
        </footer>
      </body>
    </html>
  );
}
