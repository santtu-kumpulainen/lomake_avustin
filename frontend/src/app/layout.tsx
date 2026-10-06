import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lomakeavustin",
  description: "Älykäs lomakeavustin (MVP, synteettinen data)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
