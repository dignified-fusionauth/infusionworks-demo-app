import type { Metadata } from "next";
import { Space_Grotesk, Manrope, Space_Mono } from "next/font/google";
import "./globals.css";

// Geometric display + humanist body + a printed-label mono. Deliberately
// distinct from FusionBank's serif "ledger" identity (Fraunces / IBM Plex Mono).
const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "FusionWorks — a FusionAuth B2B2E demo",
  description:
    "An internal people & approvals hub showing FusionAuth enterprise SSO, group-driven roles, entity management, and step-up auth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface text-ink font-[family-name:var(--font-body)]">
        {children}
      </body>
    </html>
  );
}
