import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "SQLLens - AI Powered Stored Procedure Analyzer",
  description:
    "Review, compare, and audit SQL Stored Procedures with AI recommendations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
